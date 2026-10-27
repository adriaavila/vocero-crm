import { randomInt } from "node:crypto";
import { and, desc, eq, gt, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";
import { chatJson } from "@/lib/ai";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { checkRateLimit, refundRateLimit } from "@/lib/rate-limit";
import { horaLocal } from "@/lib/seguimiento";
import { todayInTz } from "@/lib/time/slots";
import {
  BOTONES,
  CODIGO_MINUTOS,
  CODIGO_PREFIJO,
  codigoDeTexto,
  intencionGerente,
  lineaPlantilla,
  textoAyuda,
  textoBienvenida,
  textoCasas,
  textoCodigoMalo,
  textoDesconocido,
  textoLlamar,
  textoMejorar,
  textoPausa,
  textoVisitas,
} from "@/lib/gerente";
import { getAiRuntimeConfig } from "@/server/ai/credentials";
import { businessTimezone } from "@/server/analytics/period";
import { buildSnapshot } from "@/server/agencia/centro-ask";
import { askSystemPrompt, askUserPrompt, ASK_ANSWER_MAX } from "@/server/agencia/centro-ask-prompt";
import { datosVentas, reporteVentas, resolverNegocio } from "@/server/agencia/hermes-ventas";
import { sugerenciasVentas } from "@/lib/hermes-ventas";
import { isWindowOpen } from "@/server/inbox/window";
import { sendButtons, sendText } from "@/server/inbox/send";
import { sendTemplate } from "@/server/whatsapp/templates";

/**
 * Fork — el gerente de ventas por WhatsApp.
 *
 * Rei tiene UN número propio para todos los negocios: es un negocio más de la
 * instancia (`GERENTE_NEGOCIO`, su slug o id), con el agente en pausa, y sus
 * conversaciones quedan en su bandeja como bitácora. Lo que entra a ese número
 * no lo contesta el agente: lo contesta esto, con las cifras del negocio de
 * QUIEN escribe — la persona del equipo que conectó su WhatsApp con un código
 * (`gerente_dueno`). Nadie más ve nada.
 *
 * Las preguntas de siempre van con datos (`lib/gerente.ts`, sin modelo); el
 * resto, con el modelo y la IA del negocio del dueño, con el mismo tope que
 * «Pregúntale» en Inicio.
 *
 * Apagado sin `GERENTE_NEGOCIO`: la tarjeta de Inicio no aparece y ningún
 * mensaje se desvía.
 */

const LIMITE_PREGUNTAS = 20;
const DAY_MS = 86_400_000;
const CUERPO_BOTONES_MAX = 1024;
const respuestaSchema = z.object({ answer: z.string().trim().min(1).max(ASK_ANSWER_MAX * 3) });

let cache: { clave: string; id: string | null } | null = null;

/** El negocio dueño del número de Rei, o null si el módulo está apagado. */
export async function orgDelGerente(): Promise<string | null> {
  const clave = process.env.GERENTE_NEGOCIO?.trim();
  if (!clave) return null;
  if (cache?.clave === clave && cache.id) return cache.id;
  const id = await resolverNegocio(clave);
  cache = { clave, id };
  return id;
}

export async function esNumeroDelGerente(organizationId: string): Promise<boolean> {
  const id = await orgDelGerente();
  return id !== null && id === organizationId;
}

/** Solo tests. */
export function resetGerenteCache(): void {
  cache = null;
}

/* ---------- Conectar el WhatsApp de una persona del equipo ---------- */

export type EstadoGerente =
  | { disponible: false }
  | { disponible: true; numero: string | null; conectado: boolean; reporteSemanal: boolean; codigo: string | null; vence: string | null };

export async function estadoGerente(organizationId: string, userId: string, now: Date = new Date()): Promise<EstadoGerente> {
  const gerente = await orgDelGerente();
  if (!gerente || gerente === organizationId) return { disponible: false };
  const g = schema.gerenteDueno;
  const rows = await getDb()
    .select()
    .from(g)
    .where(scoped(g.organizationId, organizationId, eq(g.userId, userId)))
    .limit(1);
  const r = rows[0];
  const vigente = r?.codigo && r.codigoVence && r.codigoVence > now;
  return {
    disponible: true,
    numero: process.env.GERENTE_WHATSAPP?.replace(/\D/g, "") || null,
    conectado: Boolean(r?.waIdentity),
    reporteSemanal: r?.reporteSemanal ?? true,
    codigo: vigente ? `${CODIGO_PREFIJO} ${r!.codigo}` : null,
    vence: vigente ? r!.codigoVence!.toISOString() : null,
  };
}

/** Un código nuevo de 6 cifras, válido 30 minutos. Reemplaza al anterior. */
export async function codigoParaConectar(organizationId: string, userId: string, now: Date = new Date()): Promise<EstadoGerente> {
  const db = getDb();
  const g = schema.gerenteDueno;
  const vence = new Date(now.getTime() + CODIGO_MINUTOS * 60_000);
  for (let intento = 0; intento < 5; intento++) {
    const codigo = String(randomInt(0, 1_000_000)).padStart(6, "0");
    try {
      await db
        .insert(g)
        .values({ id: newId("gerenteDueno"), organizationId, userId, codigo, codigoVence: vence })
        .onConflictDoUpdate({ target: [g.organizationId, g.userId], set: { codigo, codigoVence: vence } });
      return estadoGerente(organizationId, userId, now);
    } catch (err) {
      // Choque con el código vigente de otra persona: otro número.
      if ((err as { code?: string }).code !== "23505") throw err;
    }
  }
  throw new Error("No se pudo generar un código");
}

export async function desconectarGerente(organizationId: string, userId: string): Promise<void> {
  const g = schema.gerenteDueno;
  await getDb().delete(g).where(scoped(g.organizationId, organizationId, eq(g.userId, userId)));
}

/* ---------- Lo que entra al número de Rei ---------- */

type Vinculo = { id: string; organizationId: string; negocio: string; nombre: string; reporteSemanal: boolean };

async function vinculoDe(waIdentity: string): Promise<Vinculo | null> {
  const g = schema.gerenteDueno;
  const rows = await getDb()
    .select({ id: g.id, organizationId: g.organizationId, negocio: schema.organization.name, nombre: schema.user.name, reporteSemanal: g.reporteSemanal })
    .from(g)
    .innerJoin(schema.organization, eq(schema.organization.id, g.organizationId))
    .innerJoin(schema.user, eq(schema.user.id, g.userId))
    .where(and(eq(g.waIdentity, waIdentity), isNotNull(g.conectadoAt)))
    // ponytail: quien está en dos negocios ve el último que conectó. Si pasa
    // de verdad, que el dueño elija con el nombre del negocio.
    .orderBy(desc(g.conectadoAt))
    .limit(1);
  return rows[0] ?? null;
}

async function canjearCodigo(codigo: string, waIdentity: string, now: Date): Promise<Vinculo | null> {
  const g = schema.gerenteDueno;
  const rows = await getDb()
    .update(g)
    .set({ waIdentity, conectadoAt: now, codigo: null, codigoVence: null })
    .where(and(eq(g.codigo, codigo), gt(g.codigoVence, now)))
    .returning({ id: g.id });
  return rows[0] ? vinculoDe(waIdentity) : null;
}

/** Contesta en el número de Rei: con botones si cabe, en texto si es largo. */
async function responder(conv: { organizationId: string; conversationId: string }, texto: string, botones = true): Promise<void> {
  if (botones && texto.length <= CUERPO_BOTONES_MAX) {
    await sendButtons({ ...conv, body: texto, buttons: BOTONES });
    return;
  }
  await sendText({ ...conv, text: texto, aiGenerated: true });
  if (botones) await sendButtons({ ...conv, body: "¿Qué más quieres ver?", buttons: BOTONES });
}

async function preguntaLibre(organizationId: string, negocio: string, pregunta: string, now: Date): Promise<string> {
  const tz = await businessTimezone(organizationId);
  const clave = `gerente-pregunta:${organizationId}:${todayInTz(now, tz)}`;
  if (!checkRateLimit(clave, { windowMs: DAY_MS, max: LIMITE_PREGUNTAS }, now.getTime()).allowed) {
    return `Llegaste a las ${LIMITE_PREGUNTAS} preguntas libres de hoy. «Cómo vamos», «a quién llamo» y «qué mejoro» siguen sin límite.`;
  }
  const [snapshot, ventas, config, perfil] = await Promise.all([
    buildSnapshot(organizationId, now),
    datosVentas(organizationId, "30d", now),
    getAiRuntimeConfig(organizationId),
    getDb()
      .select({ aiProvider: schema.agentProfile.aiProvider })
      .from(schema.agentProfile)
      .where(scoped(schema.agentProfile.organizationId, organizationId))
      .limit(1),
  ]);
  const r = await chatJson(
    respuestaSchema,
    [
      { role: "system", content: askSystemPrompt(negocio) },
      { role: "user", content: askUserPrompt(pregunta, { ...snapshot, ventasUltimos30Dias: ventas }) },
    ],
    { provider: perfil[0]?.aiProvider, credentials: config.providers, timeoutMs: 25_000 },
  );
  if (!r.ok) {
    refundRateLimit(clave);
    console.error(`[gerente] el proveedor no respondió (${r.error})`);
    return "No pude contestar eso ahora. Prueba «cómo vamos», «a quién llamo» o «qué mejoro».";
  }
  return r.data.answer.length > ASK_ANSWER_MAX ? `${r.data.answer.slice(0, ASK_ANSWER_MAX - 1).trimEnd()}…` : r.data.answer;
}

/**
 * Un mensaje entrante al número de Rei. Nunca lanza: un fallo aquí se anota y
 * el mensaje queda en la bandeja del número de Rei para verlo a mano.
 */
export async function atenderGerente(input: { organizationId: string; conversationId: string; text: string | null; now?: Date }): Promise<void> {
  const now = input.now ?? new Date();
  const conv = { organizationId: input.organizationId, conversationId: input.conversationId };
  try {
    const rows = await getDb()
      .select({ waIdentity: schema.contact.waIdentity })
      .from(schema.conversation)
      .innerJoin(schema.contact, eq(schema.contact.id, schema.conversation.contactId))
      .where(scoped(schema.conversation.organizationId, input.organizationId, eq(schema.conversation.id, input.conversationId)))
      .limit(1);
    const waIdentity = rows[0]?.waIdentity;
    if (!waIdentity) return;
    const texto = (input.text ?? "").trim();

    const codigo = codigoDeTexto(texto);
    if (codigo) {
      const v = await canjearCodigo(codigo, waIdentity, now);
      await responder(conv, v ? textoBienvenida(v.nombre, v.negocio) : textoCodigoMalo(), Boolean(v));
      return;
    }

    const v = await vinculoDe(waIdentity);
    if (!v) {
      await responder(conv, textoDesconocido(), false);
      return;
    }

    const intencion = intencionGerente(texto);
    if (intencion === "pausar" || intencion === "reanudar") {
      const activo = intencion === "reanudar";
      await getDb().update(schema.gerenteDueno).set({ reporteSemanal: activo }).where(eq(schema.gerenteDueno.id, v.id));
      await responder(conv, textoPausa(!activo), false);
      return;
    }
    if (intencion === "ayuda") return responder(conv, textoAyuda(v.negocio));
    if (intencion === "reporte") {
      const r = await reporteVentas(v.organizationId, { now });
      return responder(conv, r.texto);
    }
    if (intencion === "pregunta") return responder(conv, await preguntaLibre(v.organizationId, v.negocio, texto, now));

    const datos = await datosVentas(v.organizationId, "7d", now);
    const salida =
      intencion === "llamar"
        ? textoLlamar(datos)
        : intencion === "mejorar"
          ? textoMejorar(sugerenciasVentas(datos))
          : intencion === "casas"
            ? textoCasas(datos)
            : textoVisitas(datos);
    await responder(conv, salida);
  } catch (err) {
    console.error("[gerente] no se pudo contestar:", err instanceof Error ? err.message : err);
  }
}

/* ---------- El reporte de los lunes ---------- */

export const REPORTE_HORA = 8;

function esLunes(now: Date, tz: string): boolean {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(now) === "Mon";
}

/**
 * Del worker, cada minuto: a las 08:00 del lunes en la zona de cada negocio.
 * Con la ventana de 24 h abierta va el reporte entero; cerrada, la plantilla
 * `GERENTE_PLANTILLA` (utilidad) con una línea y el botón para pedirlo. Sin
 * plantilla aprobada y con la ventana cerrada, esa semana no sale: Meta no
 * deja escribirle de otro modo.
 */
export async function barrerReportesSemanales(now: Date = new Date()): Promise<number> {
  const gerente = await orgDelGerente();
  if (!gerente) return 0;
  const db = getDb();
  const g = schema.gerenteDueno;
  const vinculos = await db
    .select({ id: g.id, organizationId: g.organizationId, waIdentity: g.waIdentity, negocio: schema.organization.name })
    .from(g)
    .innerJoin(schema.organization, eq(schema.organization.id, g.organizationId))
    .where(and(isNotNull(g.waIdentity), eq(g.reporteSemanal, true)));
  let enviados = 0;
  for (const v of vinculos) {
    try {
      const tz = await businessTimezone(v.organizationId);
      if (!esLunes(now, tz) || horaLocal(now, tz) !== REPORTE_HORA) continue;
      const dia = todayInTz(now, tz);
      // Reclama la semana: el primero que escribe manda; un reinicio no repite.
      const reclamado = await db
        .update(g)
        .set({ ultimoReporte: dia })
        .where(and(eq(g.id, v.id), sql`${g.ultimoReporte} is distinct from ${dia}`))
        .returning({ id: g.id });
      if (reclamado.length === 0) continue;

      const conv = await db
        .select({ id: schema.conversation.id, lastInboundAt: schema.conversation.lastInboundAt })
        .from(schema.conversation)
        .innerJoin(schema.contact, eq(schema.contact.id, schema.conversation.contactId))
        .where(scoped(schema.conversation.organizationId, gerente, eq(schema.contact.waIdentity, v.waIdentity!), eq(schema.conversation.isTest, false)))
        .orderBy(desc(schema.conversation.lastMessageAt))
        .limit(1);
      const c = conv[0];
      if (!c) continue;
      const destino = { organizationId: gerente, conversationId: c.id };
      if (isWindowOpen(c.lastInboundAt, now)) {
        const r = await reporteVentas(v.organizationId, { now });
        await responder(destino, r.texto);
        enviados++;
        continue;
      }
      const nombre = process.env.GERENTE_PLANTILLA?.trim();
      const plantilla = nombre
        ? await db
            .select({ id: schema.template.id })
            .from(schema.template)
            .where(scoped(schema.template.organizationId, gerente, eq(schema.template.name, nombre)))
            .limit(1)
        : [];
      if (!plantilla[0]) {
        console.warn(`[gerente] ventana cerrada y sin plantilla aprobada: el reporte de ${v.organizationId} no salió`);
        continue;
      }
      const datos = await datosVentas(v.organizationId, "7d", now);
      await sendTemplate({ ...destino, templateId: plantilla[0].id, variables: [v.negocio, lineaPlantilla(datos)] });
      enviados++;
    } catch (err) {
      console.warn("[gerente] reporte semanal:", err instanceof Error ? err.message : err);
    }
  }
  return enviados;
}

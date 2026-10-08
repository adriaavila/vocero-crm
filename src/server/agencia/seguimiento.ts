import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { z } from "zod";
import { chatJson, type ChatMessage } from "@/lib/ai";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import {
  horaDecente,
  normalizarSeguimiento,
  tocaSeguimiento,
  transcriptoSeguimiento,
  VENTANA_HORAS,
} from "@/lib/seguimiento";
import { renderKb } from "@/server/ai/prompts";
import { getAiRuntimeConfig, hasConfiguredAiProvider } from "@/server/ai/credentials";
import { recordAgentDecision } from "@/server/agencia/decisions";
import {
  seguimientoInstruccion,
  seguimientoSchema,
  type SeguimientoDecision,
} from "@/server/agencia/seguimiento-prompt";
import { canAgentRespondNow, getBusinessHours } from "@/server/business-hours";
import { sendText } from "@/server/inbox/send";

/**
 * Fork — seguimiento al cliente que dejó de contestar.
 *
 * Si el dueño lo enciende (`agent_profile.follow_up_hours`), el barrido del
 * worker (cada minuto) busca conversaciones donde lo último fue una respuesta
 * del agente y el cliente lleva esas horas callado, y le pide al modelo UN
 * mensaje para retomar, o que no escriba si la conversación ya terminó. Las
 * reglas que no tocan la base (opciones, horas decentes, ventana de 24 h)
 * viven en `lib/seguimiento.ts`.
 *
 * Una sola vez por silencio: la decisión queda en `agent_decision`
 * (`follow_up` si escribió, `follow_up_skip` si no) y mientras el cliente no
 * vuelva a escribir no hay otra. El mensaje sale por `sendText` como
 * respuesta de IA, así que respeta la facturación, el cupo de prueba, la
 * pausa de la conversación y el sandbox del Laboratorio.
 */

export async function getSeguimiento(organizationId: string): Promise<number | null> {
  const rows = await getDb()
    .select({ followUpHours: schema.agentProfile.followUpHours })
    .from(schema.agentProfile)
    .where(scoped(schema.agentProfile.organizationId, organizationId))
    .limit(1);
  return normalizarSeguimiento(rows[0]?.followUpHours);
}

export async function saveSeguimiento(organizationId: string, hours: number | null): Promise<number | null> {
  const value = normalizarSeguimiento(hours);
  // Sin `updatedAt`: no cambia lo que el agente sabe (ver contenido-perfil.ts).
  await getDb()
    .update(schema.agentProfile)
    .set({ followUpHours: value })
    .where(scoped(schema.agentProfile.organizationId, organizationId));
  return value;
}

const REINTENTO_MS = 30 * 60_000;
const globalForSeguimiento = globalThis as unknown as { __voceroSeguimientoFallidos?: Map<string, number> };
function fallidos(): Map<string, number> {
  globalForSeguimiento.__voceroSeguimientoFallidos ??= new Map();
  return globalForSeguimiento.__voceroSeguimientoFallidos;
}

type Candidato = {
  conversationId: string;
  organizationId: string;
  hours: number;
  lastInboundAt: Date;
  lastMessageAt: Date;
};

/** Conversaciones donde el agente habló al último y el cliente calló lo configurado. */
export async function candidatosSeguimiento(now: Date = new Date()): Promise<Candidato[]> {
  const ventana = new Date(now.getTime() - VENTANA_HORAS * 3_600_000).toISOString();
  const rows = (await getDb().execute(sql`
    SELECT c.id, c.organization_id, p.follow_up_hours AS hours,
           (extract(epoch from c.last_inbound_at) * 1000)::float8 AS inbound_ms,
           (extract(epoch from c.last_message_at) * 1000)::float8 AS last_ms
    FROM conversation c
    JOIN agent_profile p ON p.organization_id = c.organization_id
    WHERE p.enabled = true
      AND p.follow_up_hours > 0
      AND c.is_test = false
      AND c.ai_enabled = true
      AND c.handoff_at IS NULL
      AND c.last_inbound_at > ${ventana}::timestamp
      AND c.last_message_at > c.last_inbound_at
      AND c.last_message_at <= ${now.toISOString()}::timestamp - make_interval(hours => p.follow_up_hours)
      -- Lo último que se dijo fue del agente (no de una persona del equipo).
      AND (
        SELECT m.origin FROM message m
        WHERE m.conversation_id = c.id AND m.organization_id = c.organization_id
        ORDER BY m.created_at DESC LIMIT 1
      ) = 'ai'
      -- Una vez por silencio.
      AND NOT EXISTS (
        SELECT 1 FROM agent_decision d
        WHERE d.conversation_id = c.id
          AND d.action IN ('follow_up', 'follow_up_skip')
          AND d.created_at >= c.last_inbound_at
      )
      -- Un trato ya ganado o perdido no se persigue.
      AND NOT EXISTS (
        SELECT 1 FROM lead l JOIN pipeline_stage s ON s.id = l.stage_id
        WHERE l.contact_id = c.contact_id AND l.organization_id = c.organization_id
          AND s.kind IN ('won', 'lost')
      )
    ORDER BY c.last_message_at ASC
    LIMIT 50
  `)) as unknown as { id: string; organization_id: string; hours: number; inbound_ms: number; last_ms: number }[];
  return rows
    .map((r) => ({
      conversationId: r.id,
      organizationId: r.organization_id,
      hours: Number(r.hours),
      lastInboundAt: new Date(Number(r.inbound_ms)),
      lastMessageAt: new Date(Number(r.last_ms)),
    }))
    .filter((c) => tocaSeguimiento({ ...c, now }));
}

export type ResultadoSeguimiento = "sent" | "skipped" | "not_now" | "failed";

/** Decide y, si toca, manda el seguimiento de UNA conversación. */
export async function seguirConversacion(c: Candidato, now: Date = new Date()): Promise<ResultadoSeguimiento> {
  const settings = await getBusinessHours(c.organizationId);
  if (!horaDecente(now, settings.timezone)) return "not_now";
  if (!(await canAgentRespondNow(c.organizationId, now))) return "not_now";

  const aiConfig = await getAiRuntimeConfig(c.organizationId);
  if (!hasConfiguredAiProvider(aiConfig)) return "not_now";

  const db = getDb();
  const [profile] = await db
    .select()
    .from(schema.agentProfile)
    .where(eq(schema.agentProfile.organizationId, c.organizationId))
    .limit(1);
  if (!profile) return "not_now";
  const kb = await db
    .select()
    .from(schema.kbEntry)
    .where(eq(schema.kbEntry.organizationId, c.organizationId))
    .orderBy(asc(schema.kbEntry.createdAt));
  const hilo = (
    await db
      .select({ id: schema.message.id, direction: schema.message.direction, text: schema.message.text })
      .from(schema.message)
      .where(
        and(
          eq(schema.message.conversationId, c.conversationId),
          eq(schema.message.organizationId, c.organizationId)
        )
      )
      .orderBy(desc(schema.message.createdAt))
      .limit(14)
  ).reverse();
  const transcripto = transcriptoSeguimiento(hilo);
  if (!transcripto) return "not_now";

  const ahora = new Intl.DateTimeFormat("es-ES", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: settings.timezone,
  }).format(now);
  const system = [
    `Eres "${profile.name}", el asistente de WhatsApp de este negocio. Escribes en español, breve y natural.`,
    `Ahora son las ${ahora} (zona del negocio).`,
    profile.tone ? `Tono: ${profile.tone}` : null,
    profile.instructions ? `Instrucciones del negocio:\n${profile.instructions}` : null,
    `CONOCIMIENTO DEL NEGOCIO (tu única fuente de verdad):\n${renderKb(kb)}`,
    seguimientoInstruccion(c.hours),
  ]
    .filter(Boolean)
    .join("\n\n");
  const messages: ChatMessage[] = [
    { role: "system", content: system },
    { role: "user", content: `CONVERSACIÓN HASTA AHORA:\n${transcripto}\n\nDecide y responde el JSON.` },
  ];

  const started = Date.now();
  // El esquema limpia (vacía lo inválido): su entrada no es su salida.
  const result = await chatJson(seguimientoSchema as unknown as z.ZodType<SeguimientoDecision>, messages, {
    provider: profile.aiProvider,
    credentials: aiConfig.providers,
  });
  const meta = {
    latencyMs: Date.now() - started,
    ...(result.ok ? { model: result.model, tokens: result.usage } : {}),
  };
  const decide = (action: "follow_up" | "follow_up_skip", replyMessageIds: string[] = [], summary = "") =>
    recordAgentDecision({
      organizationId: c.organizationId,
      conversationId: c.conversationId,
      isTest: false,
      brain: "rei",
      action,
      steps: [{ tool: "seguimiento", summary: summary || `${c.hours} h sin respuesta del cliente`, ok: true }],
      triggerMessageIds: [],
      replyMessageIds,
      ...meta,
    });

  if (!result.ok) {
    // Sin decisión registrada se reintenta, pero no cada minuto: espera
    // `REINTENTO_MS` (la ventana de 24 h acota el total).
    fallidos().set(c.conversationId, now.getTime() + REINTENTO_MS);
    console.error(`[seguimiento] el modelo falló en ${c.conversationId}: ${result.detail ?? result.error}`);
    return "failed";
  }
  const text = result.data.text.trim();
  if (!result.data.send || text.length < 2) {
    await decide("follow_up_skip", [], "la conversación ya había terminado");
    return "skipped";
  }

  // `sendText` lanza si la conversación se pausó, se acabó el cupo, la
  // facturación frena o Meta rechaza: eso también cierra este silencio.
  let messageId: string;
  try {
    ({ messageId } = await sendText({
      conversationId: c.conversationId,
      organizationId: c.organizationId,
      text,
      aiGenerated: true,
    }));
  } catch (error) {
    const motivo = error instanceof Error ? error.message : "rechazado";
    await decide("follow_up_skip", [], `no se pudo enviar: ${motivo}`.slice(0, 200));
    return "skipped";
  }
  await decide("follow_up", [messageId]);
  return "sent";
}

/** Barrido del worker. Secuencial: son pocos y cada uno llama al modelo. */
export async function barrerSeguimientos(now: Date = new Date()): Promise<number> {
  const candidatos = await candidatosSeguimiento(now);
  let enviados = 0;
  const espera = fallidos();
  for (const [id, hasta] of espera) if (hasta <= now.getTime()) espera.delete(id);
  for (const c of candidatos) {
    if (espera.has(c.conversationId)) continue;
    const r = await seguirConversacion(c, now).catch((error) => {
      console.error(`[seguimiento] ${c.conversationId} falló:`, error);
      return "failed" as const;
    });
    if (r === "sent") enviados++;
  }
  if (enviados > 0) console.log(`[seguimiento] el agente retomó ${enviados} conversación(es) en silencio`);
  return enviados;
}

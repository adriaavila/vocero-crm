import { z } from "zod";
import { chatJson } from "@/lib/ai";
import { brand } from "@/lib/brand";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { peekRateLimit, checkRateLimit, refundRateLimit } from "@/lib/rate-limit";
import { todayInTz } from "@/lib/time/slots";
import { getAiRuntimeConfig } from "@/server/ai/credentials";
import { businessTimezone } from "@/server/analytics/period";
import { getBranding } from "@/server/branding";
import { agentOn } from "@/server/agencia/estado";
import { canAutomate } from "@/server/agencia/entitlements";
import { getCentroMetricas, pipelineNow } from "@/server/agencia/centro-metricas";
import { askSystemPrompt, askUserPrompt, ASK_ANSWER_MAX } from "@/server/agencia/centro-ask-prompt";
import { listDecisions } from "@/server/agencia/decisions-read";
import { CANDIDATE_CAP, getPrioridades, type PriorityCard, type Prioridades } from "@/server/agencia/prioridades";

/**
 * Capa de agencia (fork) — «Pregúntale a allok». Una pregunta en texto libre
 * se contesta con un resumen COMPACTO de ESTA organización (cifras, las
 * tarjetas de «Por dónde arrancar», el embudo y las últimas decisiones con su
 * veredicto) y nada más: ni payloads crudos, ni teléfonos, ni otros negocios.
 * Las tres preguntas sugeridas NO usan el modelo: se contestan aquí, con los
 * mismos datos, sin gastar cupo.
 *
 * Nunca se loguea la pregunta ni la respuesta: son contenido del negocio.
 */

export const ASK_DAILY_LIMIT = 20;
const DAY_MS = 24 * 60 * 60 * 1000;
const ASK_TIMEOUT_MS = 25_000;
const RISK_WINDOW_MS = 6 * 3_600_000;

const answerSchema = z.object({ answer: z.string().trim().min(1).max(ASK_ANSWER_MAX * 3) });

export const CHIP_KINDS = ["hoy", "riesgo", "semana"] as const;
export type ChipKind = (typeof CHIP_KINDS)[number];

/** La hora de pared del negocio («2026-10-03 13:37»): el modelo no debe razonar en UTC. */
export function localStamp(date: Date | string, timezone: string): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: timezone, dateStyle: "short", timeStyle: "short" }).format(new Date(date));
}

export type AskSnapshot = {
  negocio: string;
  zona: string;
  ahora: string;
  hoy: { conversaciones: number; leadsNuevos: number; respondioElAgente: number; respondieronPersonas: number };
  ultimos7Dias: { conversaciones: number; leadsNuevos: number; respondioElAgente: number; respondieronPersonas: number };
  porAtender: {
    teNecesitan: number;
    elAgenteLasAtiende: number;
    ventanaCerrada: number;
    /** «200+» si se llegó al techo de lo que se evalúa. */
    total: number | string;
    principales: {
      contacto: string;
      razon: string;
      detalle: string | null;
      ventana: string;
      lasAtiende: string;
      /** Texto de un cliente, SIN verificar. */
      mensajeDelCliente: string | null;
    }[];
  };
  embudoAhora: { etapa: string; leads: number }[];
  ultimasDecisiones: {
    cuando: string;
    accion: string;
    motivoDeTraspaso: string | null;
    veredicto: "bien" | "fallo" | null;
    nota: string | null;
  }[];
};

export async function buildSnapshot(organizationId: string, now: Date = new Date()): Promise<AskSnapshot> {
  const agent = await agentOn(organizationId);
  const [branding, hoy, semana, prioridades, embudo, decisiones] = await Promise.all([
    getBranding(organizationId),
    getCentroMetricas(organizationId, "hoy", now),
    getCentroMetricas(organizationId, "7d", now),
    getPrioridades(organizationId, { agentOn: agent.on, now }),
    pipelineNow(organizationId),
    listDecisions(organizationId, { limit: 10 }),
  ]);
  const counts = (m: typeof hoy) => ({
    conversaciones: m.conversations.total,
    leadsNuevos: m.leads.total,
    respondioElAgente: m.replies.ai,
    respondieronPersonas: m.replies.owner,
  });
  const name = brand().name;
  return {
    negocio: branding.name,
    zona: hoy.timezone,
    ahora: localStamp(now, hoy.timezone),
    hoy: counts(hoy),
    ultimos7Dias: counts(semana),
    porAtender: {
      teNecesitan: prioridades.needsYou,
      elAgenteLasAtiende: prioridades.live,
      ventanaCerrada: prioridades.closed,
      total: prioridades.capped ? `${CANDIDATE_CAP}+` : prioridades.total,
      principales: prioridades.cards.map((c) => ({
        contacto: c.name,
        razon: c.reasonLabel,
        detalle: c.reasonDetail,
        ventana: c.windowLabel,
        lasAtiende: c.handler === "agente" ? name : "una persona",
        mensajeDelCliente: c.preview,
      })),
    },
    embudoAhora: embudo.map((s) => ({ etapa: s.name, leads: s.count })),
    ultimasDecisiones:
      decisiones === "invalid_cursor"
        ? []
        : decisiones.decisions.map((d) => ({
            cuando: localStamp(d.createdAt, hoy.timezone),
            accion: d.action,
            motivoDeTraspaso: d.handoffReason,
            veredicto: d.verdict,
            nota: d.verdictNote,
          })),
  };
}

/* ---------- Las preguntas sugeridas: sin modelo ---------- */

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const count = (p: Prioridades) => (p.capped ? `${CANDIDATE_CAP}+` : String(p.needsYou));

/** «Se cierra en 7 min» / «Quedan 3 h» tal cual lo dice la tarjeta, para leerlo en una frase. */
const cardLine = (c: PriorityCard) => `${c.name} (${lower(c.reasonLabel)}; ${lower(c.windowLabel)})`;

export function chipAnswer(
  kind: ChipKind,
  data: { prioridades: Prioridades; allCards: PriorityCard[]; semana: Awaited<ReturnType<typeof getCentroMetricas>>; productLabel: string },
): string {
  const { prioridades: p, productLabel } = data;
  if (kind === "hoy") {
    const open = p.cards.filter((c) => c.windowOpen && c.handler === "persona");
    if (p.needsYou === 0) {
      const tail = p.closed > 0 ? ` Quedan ${p.closed} con la ventana cerrada: solo se les escribe con plantilla.` : "";
      return p.live > 0
        ? `Nada te espera: ${productLabel} está respondiendo ${p.live} ${plural(p.live, "conversación", "conversaciones")}.${tail}`
        : `Nada te espera ahora.${tail}`;
    }
    const [first, ...rest] = open;
    const next = rest.slice(0, 2).map((c) => c.name);
    return (
      `${count(p)} ${plural(p.needsYou, "conversación te necesita", "conversaciones te necesitan")}. ` +
      `Empieza por ${first ? cardLine(first) : "la primera tarjeta"}.` +
      (next.length ? ` Después: ${next.join(" y ")}.` : "") +
      (p.closed > 0 ? ` ${p.closed} más con la ventana cerrada.` : "")
    );
  }
  if (kind === "riesgo") {
    const risky = data.allCards.filter((c) => c.windowOpen && c.handler === "persona" && c.remainingMs < RISK_WINDOW_MS);
    const closed = data.allCards.filter((c) => !c.windowOpen).length;
    const closedText = closed > 0 ? ` ${closed} ${plural(closed, "ya cerró su ventana", "ya cerraron su ventana")}: solo con plantilla.` : "";
    if (risky.length === 0) return `Ningún lead pierde su ventana en las próximas 6 h.${closedText}`;
    const shown = risky.slice(0, 4).map(cardLine).join("; ");
    return `${risky.length} ${plural(risky.length, "lead pierde", "leads pierden")} su ventana en menos de 6 h: ${shown}.${risky.length > 4 ? ` Y ${risky.length - 4} más.` : ""}${closedText}`;
  }
  const s = data.semana;
  if (!s.hasActivity) return "Todavía no hay mensajes que contar esta semana.";
  return (
    `En los últimos 7 días: ${s.conversations.total} ${plural(s.conversations.total, "conversación", "conversaciones")} y ` +
    `${s.leads.total} ${plural(s.leads.total, "lead nuevo", "leads nuevos")}. ` +
    `Respondió ${productLabel} ${s.replies.ai} ${plural(s.replies.ai, "vez", "veces")} y tú ${s.replies.owner}.`
  );
}

export async function answerChip(organizationId: string, kind: ChipKind, now: Date = new Date()): Promise<string> {
  const agent = await agentOn(organizationId);
  const [prioridades, allCards, semana] = await Promise.all([
    getPrioridades(organizationId, { agentOn: agent.on, now }),
    kind === "riesgo"
      ? getPrioridades(organizationId, { agentOn: agent.on, now, limit: CANDIDATE_CAP }).then((p) => p.cards)
      : Promise.resolve([] as PriorityCard[]),
    kind === "semana" ? getCentroMetricas(organizationId, "7d", now) : getCentroMetricas(organizationId, "hoy", now),
  ]);
  return chipAnswer(kind, { prioridades, allCards, semana, productLabel: brand().name });
}

/* ---------- Texto libre: con el modelo, con tope diario ---------- */

const askKey = (organizationId: string, timezone: string, now: Date) => `centro-ask:${organizationId}:${todayInTz(now, timezone)}`;
const LIMIT = { windowMs: DAY_MS, max: ASK_DAILY_LIMIT };

/** Cuántas preguntas libres le quedan HOY (día del negocio) a esta organización. */
export async function askRemaining(organizationId: string, now: Date = new Date()): Promise<number> {
  const tz = await businessTimezone(organizationId);
  return peekRateLimit(askKey(organizationId, tz, now), LIMIT, now.getTime());
}

export type AskResult =
  | { ok: true; answer: string; remaining: number | null; source: "datos" | "ia" }
  | {
      ok: false;
      status: 402 | 409 | 429 | 503;
      code: "billing_inactive" | "rate_limited" | "not_configured" | "provider_error";
      message: string;
    };

export async function askCentro(organizationId: string, question: string, now: Date = new Date()): Promise<AskResult> {
  // El plan debe dejar automatizar (en el SaaS): es gasto de IA del negocio.
  if (!(await canAutomate(organizationId))) {
    return { ok: false, status: 402, code: "billing_inactive", message: `Reactiva tu plan para preguntarle a ${brand().name}.` };
  }
  // Por día DEL NEGOCIO, para que coincida con «hoy» y «mañana» del texto.
  // ponytail: en memoria y por proceso. Con varias réplicas el tope real es
  // 20 × réplicas, y un reinicio lo vuelve a cero. Para un tope firme, un
  // contador por organización y día en la base.
  const tz = await businessTimezone(organizationId);
  const key = askKey(organizationId, tz, now);
  const limit = checkRateLimit(key, LIMIT, now.getTime());
  if (!limit.allowed) {
    return {
      ok: false,
      status: 429,
      code: "rate_limited",
      message: `Llegaste al límite de ${ASK_DAILY_LIMIT} preguntas por hoy. Mañana vuelves a tener las ${ASK_DAILY_LIMIT}.`,
    };
  }

  const [snapshot, config, profile] = await Promise.all([
    buildSnapshot(organizationId, now),
    getAiRuntimeConfig(organizationId),
    getDb()
      .select({ aiProvider: schema.agentProfile.aiProvider })
      .from(schema.agentProfile)
      .where(scoped(schema.agentProfile.organizationId, organizationId))
      .limit(1),
  ]);

  const result = await chatJson(
    answerSchema,
    [
      { role: "system", content: askSystemPrompt(snapshot.negocio) },
      { role: "user", content: askUserPrompt(question, snapshot) },
    ],
    { provider: profile[0]?.aiProvider, credentials: config.providers, timeoutMs: ASK_TIMEOUT_MS },
  );

  if (!result.ok) {
    // Una llamada que falla por culpa nuestra o del proveedor no gasta cupo.
    refundRateLimit(key);
    // Solo el código: `detail` puede traer lo que el modelo contestó.
    console.error(`[centro-ask] el proveedor no respondió (${result.error})`);
    return result.error === "not_configured"
      ? {
          ok: false,
          status: 409,
          code: "not_configured",
          message: "La IA todavía no está configurada en tu espacio, así que no puedo contestar preguntas.",
        }
      : {
          ok: false,
          status: 503,
          code: "provider_error",
          message: "No pude contestar ahora. Prueba de nuevo en un momento.",
        };
  }

  const answer = result.data.answer.length > ASK_ANSWER_MAX ? `${result.data.answer.slice(0, ASK_ANSWER_MAX - 1).trimEnd()}…` : result.data.answer;
  return { ok: true, answer, remaining: limit.remaining, source: "ia" };
}

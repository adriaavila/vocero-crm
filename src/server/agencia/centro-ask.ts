import { z } from "zod";
import { chatJson } from "@/lib/ai";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { checkRateLimit } from "@/lib/rate-limit";
import { getAiRuntimeConfig } from "@/server/ai/credentials";
import { getBranding } from "@/server/branding";
import { agentOn } from "@/server/agencia/estado";
import { getCentroMetricas, pipelineNow } from "@/server/agencia/centro-metricas";
import { askSystemPrompt, askUserPrompt, ASK_ANSWER_MAX } from "@/server/agencia/centro-ask-prompt";
import { listDecisions } from "@/server/agencia/decisions-read";
import { getPrioridades } from "@/server/agencia/prioridades";

/**
 * Capa de agencia (fork) — «Pregúntale a allok». Una pregunta en texto libre
 * se contesta con un resumen COMPACTO de ESTA organización (cifras, las
 * tarjetas de «Por dónde arrancar», el embudo y las últimas decisiones con su
 * veredicto) y nada más: ni payloads crudos, ni teléfonos, ni otros negocios.
 *
 * Nunca se loguea la pregunta ni la respuesta: son contenido del negocio.
 */

export const ASK_DAILY_LIMIT = 20;
const DAY_MS = 24 * 60 * 60 * 1000;
const ASK_TIMEOUT_MS = 25_000;

const answerSchema = z.object({ answer: z.string().trim().min(1).max(ASK_ANSWER_MAX * 3) });

export type AskSnapshot = {
  negocio: string;
  zona: string;
  ahora: string;
  hoy: { conversaciones: number; leadsNuevos: number; respondioElAgente: number; respondieronPersonas: number };
  ultimos7Dias: { conversaciones: number; leadsNuevos: number; respondioElAgente: number; respondieronPersonas: number };
  porAtender: {
    teNecesitan: number;
    laAgenteLasAtiende: number;
    ventanaCerrada: number;
    total: number;
    principales: {
      contacto: string;
      razon: string;
      detalle: string | null;
      ventana: string;
      lasAtiende: "el agente" | "una persona";
      ultimoMensaje: string | null;
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
  return {
    negocio: branding.name,
    zona: hoy.timezone,
    ahora: now.toISOString(),
    hoy: counts(hoy),
    ultimos7Dias: counts(semana),
    porAtender: {
      teNecesitan: prioridades.needsYou,
      laAgenteLasAtiende: prioridades.live,
      ventanaCerrada: prioridades.closed,
      total: prioridades.total,
      principales: prioridades.cards.map((c) => ({
        contacto: c.name,
        razon: c.reasonLabel,
        detalle: c.reasonDetail,
        ventana: c.windowLabel,
        lasAtiende: c.handler === "agente" ? "el agente" : "una persona",
        ultimoMensaje: c.preview,
      })),
    },
    embudoAhora: embudo.map((s) => ({ etapa: s.name, leads: s.count })),
    ultimasDecisiones:
      decisiones === "invalid_cursor"
        ? []
        : decisiones.decisions.map((d) => ({
            cuando: d.createdAt,
            accion: d.action,
            motivoDeTraspaso: d.handoffReason,
            veredicto: d.verdict,
            nota: d.verdictNote,
          })),
  };
}

export type AskResult =
  | { ok: true; answer: string; remaining: number }
  | { ok: false; status: 409 | 429 | 503; code: "rate_limited" | "not_configured" | "provider_error"; message: string };

export async function askCentro(organizationId: string, question: string, now: Date = new Date()): Promise<AskResult> {
  // ponytail: en memoria y por proceso. Con varias réplicas el tope real es
  // 20 × réplicas, y un reinicio lo vuelve a cero. Para un tope firme, un
  // contador por organización y día en la base.
  const limit = checkRateLimit(`centro-ask:${organizationId}`, { windowMs: DAY_MS, max: ASK_DAILY_LIMIT }, now.getTime());
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
  return { ok: true, answer, remaining: limit.remaining };
}

import { createHmac } from "node:crypto";
import type { BotContext } from "@/server/bot/context";
import type { BotProfile } from "@/server/bot/profile";

/**
 * Despacho de un turno a Nea (cerebro externo por defecto).
 *
 * Contrato fijo (construido en paralelo del lado de Nea):
 * `POST ${NEA_DISPATCH_URL}` firmado con `X-Signature: sha256=<hmac>` sobre
 * el body EXACTO enviado. SÍNCRONO: Nea responde 200 solo después de haber
 * POSTeado su respuesta a `/api/bot/messages`.
 *
 * Dispatch v2 (Nea sin estado): `dispatchToNea` hace UN solo intento HTTP y
 * devuelve un resultado tipado en vez de reintentar internamente — el
 * reintento (rebuilding el snapshot con datos frescos en cada vuelta) vive
 * ahora en `runNeaAgentTurn` (`server/ai/pipeline.ts`), porque solo ahí hay
 * acceso a la BD para recalcular qué sigue pendiente. Ver `NeaDispatchOutcome`.
 */

const DISPATCH_TIMEOUT_MS = 90_000;

export type NeaMessage = {
  /** wa_message_id — null en mensajes del Laboratorio (nunca tocan Meta). */
  id: string | null;
  type: string;
  text: string | null;
  /** media id de Graph si el mensaje trae adjunto; null si no. */
  mediaId: string | null;
  timestamp: string;
};

/** Payload v1 — CONGELADO. El Nea hoy desplegado solo conoce esta forma. */
export type NeaDispatchPayload = {
  organizationId: string;
  conversationId: string;
  isTest: boolean;
  contact: { identity: string; name: string };
  messages: NeaMessage[];
};

export type NeaHistoryRole = "lead" | "agent" | "team" | "owner";

export type NeaHistoryMedia = {
  /** media id de Graph; null en location/contacts o si no hay adjunto. */
  mediaId: string | null;
  mime: string | null;
  fileName: string | null;
  caption: string | null;
  /** ≤4000 caracteres — ver `POST /api/bot/messages/[id]/transcript`. */
  transcript: string | null;
  location: unknown | null;
  /**
   * El payload de Meta TAL CUAL, sin transformar (`message.contacts` del
   * webhook de WhatsApp — `mediaAsset.payload` para un mensaje `kind:
   * "contacts"`, ver `server/inbox/ingest.ts`): un arreglo de objetos con
   * forma `{ name: { formatted_name, first_name } | string, phones?:
   * [{ phone, type? }], emails?: [...], ... }` — cada implementación de
   * cliente de WhatsApp manda un subconjunto distinto de campos, así que no
   * se normaliza aquí. `null` salvo en un mensaje de tipo `contacts`.
   */
  contacts: unknown | null;
} | null;

export type NeaHistoryItem = {
  id: string;
  role: NeaHistoryRole;
  type: string;
  /** ≤2000 caracteres. */
  text: string | null;
  /** ISO. */
  at: string;
  /** true ⇒ está en el conjunto pendiente de este despacho. */
  pending: boolean;
  media: NeaHistoryMedia;
};

export type NeaOffer = { startUtc: string; label: string };

export type NeaLlm = {
  provider: "openrouter" | "openai";
  model: string;
  apiKey: string;
} | null;

/**
 * Payload v2 — SUPERSET de v1: todo campo de v1 viaja idéntico, así que el
 * Nea hoy desplegado (que solo lee v1) sigue funcionando sin cambios.
 */
export type NeaDispatchPayloadV2 = NeaDispatchPayload & {
  version: 2;
  /** SaaS: `agent_job.id` (estable entre reintentos). Debounce/Lab: `dsp_…`. */
  dispatchId: string;
  /** Número de intento del turno (0-based); solo para logs. */
  attempt: number;
  context: BotContext;
  profile: BotProfile;
  history: NeaHistoryItem[];
  offers: NeaOffer[];
  /** null salvo que la organización tenga SU PROPIA clave — nunca la de plataforma. */
  llm: NeaLlm;
};

export type NeaResponseBody = {
  ok: boolean;
  action: "replied" | "silent" | "noop" | "reset";
  llm?: { source: "platform" | "org"; status: string };
  handoff?: { reason: string; applied: boolean };
};

export type NeaDispatchOutcome =
  | { kind: "ok"; body: NeaResponseBody }
  /** 4xx: el payload está mal — repetirlo no lo arregla. */
  | { kind: "client_error"; status: number; message: string }
  /** 5xx o red/timeout: vale la pena reintentar con un snapshot fresco. */
  | { kind: "retryable"; status: number | null; message: string };

/** Mensaje crudo tal como sale de la BD, en orden cronológico ascendente. */
export type NeaSourceMessage = {
  id: string;
  waMessageId: string | null;
  direction: "in" | "out";
  type: string;
  text: string | null;
  mediaWaId: string | null;
  timestamp: Date;
};

/**
 * Selección de mensajes SOLO para conversaciones de prueba (Laboratorio):
 * los entrantes DESPUÉS del último saliente. Sin un saliente previo
 * (conversación nueva), todos los entrantes cuentan. Si esa selección queda
 * vacía, cae al último entrante — jamás se despacha con cero mensajes.
 *
 * Las conversaciones reales NO usan esto — ver `runNeaAgentTurn` en
 * `pipeline.ts`: mandan los últimos entrantes de las últimas 24h y Nea
 * dedupea por `wa_message_id`, porque un mensaje de prueba no tiene id que
 * dedupear (siempre `null`) y sin este recorte Nea vería mensajes de
 * simulaciones viejas.
 */
export function selectMessagesForNea(
  messages: NeaSourceMessage[]
): NeaSourceMessage[] {
  let lastOutIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.direction === "out") {
      lastOutIndex = i;
      break;
    }
  }
  const since = lastOutIndex === -1 ? messages : messages.slice(lastOutIndex + 1);
  const inbound = since.filter((m) => m.direction === "in");
  if (inbound.length) return inbound;

  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.direction === "in") return [messages[i]!];
  }
  return [];
}

/**
 * Arma el payload del contrato a partir de los mensajes YA seleccionados por
 * quien llama (la estrategia de selección difiere entre prueba y real — ver
 * `runNeaAgentTurn`).
 */
export function buildNeaPayload(input: {
  organizationId: string;
  conversationId: string;
  isTest: boolean;
  contact: { identity: string; name: string };
  messages: NeaSourceMessage[];
}): NeaDispatchPayload {
  return {
    organizationId: input.organizationId,
    conversationId: input.conversationId,
    isTest: input.isTest,
    contact: input.contact,
    messages: input.messages.map((m) => ({
      id: m.waMessageId,
      type: m.type,
      text: m.text,
      mediaId: m.mediaWaId,
      timestamp: m.timestamp.toISOString(),
    })),
  };
}

function sign(body: string): string {
  const key = process.env.BOT_API_KEY?.trim() ?? "";
  return `sha256=${createHmac("sha256", key).update(body).digest("hex")}`;
}

/**
 * Un solo intento HTTP contra Nea — SIN reintentar. El reintento (dispatch v2)
 * vive en `runNeaAgentTurn`, que es quien puede reconstruir el snapshot con
 * datos frescos entre un intento y el siguiente; aquí no hay forma de saber
 * si algo cambió mientras tanto.
 *
 * Lanza SOLO si `NEA_DISPATCH_URL` no está configurada (error de
 * configuración, no de despacho). Cualquier otro desenlace — 2xx, 4xx, 5xx o
 * fallo de red/timeout — vuelve como `NeaDispatchOutcome` para que quien llama
 * decida sin necesitar un try/catch por caso.
 */
export async function dispatchToNea(
  payload: NeaDispatchPayload | NeaDispatchPayloadV2
): Promise<NeaDispatchOutcome> {
  const url = process.env.NEA_DISPATCH_URL?.trim();
  if (!url) throw new Error("NEA_DISPATCH_URL no está configurada");

  const body = JSON.stringify(payload);
  const headers = {
    "Content-Type": "application/json",
    "X-Signature": sign(body),
  };

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(DISPATCH_TIMEOUT_MS),
    });
  } catch (err) {
    return {
      kind: "retryable",
      status: null,
      message: `Nea no respondió: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (response.ok) {
    return { kind: "ok", body: await safeResponseBody(response) };
  }
  if (response.status >= 500) {
    return { kind: "retryable", status: response.status, message: `Nea devolvió ${response.status}` };
  }
  // 4xx: el payload está mal, repetirlo no ayuda.
  return { kind: "client_error", status: response.status, message: `Nea devolvió ${response.status}` };
}

/**
 * El Nea v1 hoy desplegado responde 200 sin body (o con uno que no sigue el
 * contrato v2) — un JSON inválido o ausente nunca debe tumbar el turno: se
 * interpreta como "sin novedad", que es exactamente lo que significa un 2xx
 * de un Nea que todavía no sabe de `action`/`llm`/`handoff`.
 */
async function safeResponseBody(response: Response): Promise<NeaResponseBody> {
  try {
    const raw: unknown = await response.json();
    if (raw && typeof raw === "object") {
      return { ok: true, action: "noop", ...raw } as NeaResponseBody;
    }
  } catch {
    // sin body o no es JSON — Nea v1.
  }
  return { ok: true, action: "noop" };
}

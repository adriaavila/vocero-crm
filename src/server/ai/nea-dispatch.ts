import { createHmac } from "node:crypto";

/**
 * Despacho de un turno a Nea (cerebro externo por defecto).
 *
 * Contrato fijo (construido en paralelo del lado de Nea):
 * `POST ${NEA_DISPATCH_URL}` firmado con `X-Signature: sha256=<hmac>` sobre
 * el body EXACTO enviado. SÍNCRONO: Nea responde 200 solo después de haber
 * POSTeado su respuesta a `/api/bot/messages`. Un fallo (no-2xx o timeout) se
 * propaga como excepción — quien llama decide qué hacer (needs_review +
 * handoff en el worker de SaaS, log + handoff en el debounce legado).
 */

const DISPATCH_TIMEOUT_MS = 90_000;
/** Reintentos ante error de red o 5xx: ~2s y luego ~5s. Un 4xx NO reintenta
 * (el payload está mal formado o el body no cambiará al repetirlo). */
const RETRY_DELAYS_MS = [2_000, 5_000];

export type NeaMessage = {
  /** wa_message_id — null en mensajes del Laboratorio (nunca tocan Meta). */
  id: string | null;
  type: string;
  text: string | null;
  /** media id de Graph si el mensaje trae adjunto; null si no. */
  mediaId: string | null;
  timestamp: string;
};

export type NeaDispatchPayload = {
  organizationId: string;
  conversationId: string;
  isTest: boolean;
  contact: { identity: string; name: string };
  messages: NeaMessage[];
};

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

/**
 * POSTea el turno a Nea y espera su respuesta. Reintenta un error de red o
 * un 5xx hasta 2 veces con backoff (~2s, ~5s) — una salida corta de Nea no
 * debe pausar toda conversación en curso (`needs_review` + handoff `error`
 * en cada tenant que tuviera un turno en vuelo). Un 4xx NO reintenta: el
 * problema es el payload, no la red, y repetirlo no lo arregla. Lanza si
 * `NEA_DISPATCH_URL` no está configurada, o si se agotan los reintentos.
 */
export async function dispatchToNea(payload: NeaDispatchPayload): Promise<void> {
  const url = process.env.NEA_DISPATCH_URL?.trim();
  if (!url) throw new Error("NEA_DISPATCH_URL no está configurada");

  const body = JSON.stringify(payload);
  const headers = {
    "Content-Type": "application/json",
    "X-Signature": sign(body),
  };

  let lastError: Error = new Error("Nea no respondió");
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) await sleep(RETRY_DELAYS_MS[attempt - 1]!);

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers,
        body,
        signal: AbortSignal.timeout(DISPATCH_TIMEOUT_MS),
      });
    } catch (err) {
      lastError = new Error(
        `Nea no respondió: ${err instanceof Error ? err.message : String(err)}`
      );
      continue; // red/timeout: reintenta
    }

    if (response.ok) return;
    if (response.status >= 500) {
      lastError = new Error(`Nea devolvió ${response.status}`);
      continue; // 5xx: reintenta
    }
    // 4xx: el payload está mal, repetirlo no ayuda.
    throw new Error(`Nea devolvió ${response.status}`);
  }
  throw lastError;
}

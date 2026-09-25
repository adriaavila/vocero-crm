import { createHmac } from "node:crypto";

/**
 * Despacho de un turno a Nea (cerebro externo por defecto).
 *
 * Contrato fijo (construido en paralelo del lado de Nea):
 * `POST ${NEA_DISPATCH_URL}` firmado con `X-Signature: sha256=<hmac>` sobre
 * el body EXACTO enviado. SÍNCRONO: Nea responde 200 solo después de haber
 * POSTeado su respuesta a `/api/bot/messages`. Un fallo (no-2xx o timeout) se
 * propaga como excepción — quien llama decide qué hacer (needs_review +
 * handoff en el worker de SaaS, solo log en el debounce legado).
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
 * Qué mensajes le tocan a Nea en este turno: los entrantes DESPUÉS del último
 * saliente de la conversación. Sin un saliente previo (conversación nueva),
 * todos los entrantes cuentan. Si por lo que sea esa selección queda vacía
 * (p. ej. una ráfaga de eventos sin inbound nuevo), cae al último entrante —
 * jamás se despacha con cero mensajes.
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

/** Arma el payload del contrato a partir de los mensajes ya seleccionados. */
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
    messages: selectMessagesForNea(input.messages).map((m) => ({
      id: m.waMessageId,
      type: m.type,
      text: m.text,
      mediaId: m.mediaWaId,
      timestamp: m.timestamp.toISOString(),
    })),
  };
}

function sign(body: string): string {
  const key = process.env.BOT_API_KEY ?? "";
  return `sha256=${createHmac("sha256", key).update(body).digest("hex")}`;
}

/**
 * POSTea el turno a Nea y espera su respuesta. Lanza si Nea no está
 * configurada, si responde algo que no sea 2xx, o si se agota el timeout.
 */
export async function dispatchToNea(payload: NeaDispatchPayload): Promise<void> {
  const url = process.env.NEA_DISPATCH_URL?.trim();
  if (!url) throw new Error("NEA_DISPATCH_URL no está configurada");

  const body = JSON.stringify(payload);
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Signature": sign(body),
      },
      body,
      signal: AbortSignal.timeout(DISPATCH_TIMEOUT_MS),
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`Nea no respondió: ${detail}`);
  }
  if (!response.ok) {
    throw new Error(`Nea devolvió ${response.status}`);
  }
}

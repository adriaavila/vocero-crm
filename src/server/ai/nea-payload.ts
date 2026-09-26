import { buildBotContext } from "@/server/bot/context";
import { buildBotProfile } from "@/server/bot/profile";
import { getOffers } from "@/server/agenda/offers";
import { getNeaLlmCredential } from "@/server/ai/credentials";
import { buildHistoryAndPending } from "@/server/ai/nea-history";
import {
  buildNeaPayload,
  type NeaDispatchPayloadV2,
  type NeaSourceMessage,
} from "@/server/ai/nea-dispatch";

/**
 * Ensamblado del snapshot que se despacha a Nea (dispatch v2). Se reconstruye
 * ENTERO en cada intento de `runNeaAgentTurn` — nunca se reusa uno viejo entre
 * reintentos, porque lo pendiente pudo cambiar mientras Nea no contestaba.
 *
 * El historial y el conjunto pendiente (`buildHistoryAndPending`, con toda su
 * mecánica SQL de corte por microsegundos) viven en `nea-history.ts` — en su
 * propio módulo para poder mockearlo como una unidad desde las pruebas de
 * `buildNeaTurnSnapshot`, algo que un `vi.mock` no puede hacer cuando la
 * llamada es interna al mismo archivo.
 */

export { computePendingCutoff, PENDING_LIMIT } from "@/server/ai/nea-history";

export type NeaTurnSnapshot = {
  payload: NeaDispatchPayloadV2;
  /**
   * Los ids del conjunto pendiente de ESTE snapshot — `advanceCursor`
   * (`pipeline.ts`) calcula `MAX(created_at)` en SQL a partir de ellos.
   * Nunca un `Date` de JS: ver el comentario en `buildHistoryAndPending`.
   */
  pendingIds: string[];
  /** El proveedor+IV de la credencial de org enviada (si hubo). */
  orgCredential: { provider: "openai" | "openrouter"; keyIv: string } | null;
};

/**
 * Ensambla el snapshot completo del turno. `null` ⇒ nada pendiente, el
 * llamador NO debe despachar.
 *
 * `v1Messages` se recibe ya seleccionado por el llamador (misma estrategia de
 * SIEMPRE — Laboratorio vs. conversación real, ver `pipeline.ts`): el campo
 * `messages` es v1 CONGELADO y no se deriva del conjunto pendiente nuevo.
 *
 * NO recibe `memoryResetAt`/`agentCursorAt`: se leen frescos en SQL dentro de
 * `buildHistoryAndPending` en cada llamada — nunca a través de un valor que
 * el llamador pudo haber leído hace uno o varios intentos.
 */
export async function buildNeaTurnSnapshot(input: {
  organizationId: string;
  conversationId: string;
  isTest: boolean;
  dispatchId: string;
  attempt: number;
  contact: { identity: string; name: string };
  v1Messages: NeaSourceMessage[];
}): Promise<NeaTurnSnapshot | null> {
  const now = new Date();
  const historyResult = await buildHistoryAndPending({
    organizationId: input.organizationId,
    conversationId: input.conversationId,
    now,
  });
  if (!historyResult) return null; // nada pendiente: no se despacha.

  const [context, profile, offersRaw, llmCredential] = await Promise.all([
    buildBotContext(input.organizationId, input.conversationId),
    buildBotProfile(input.organizationId),
    getOffers(input.organizationId, input.conversationId),
    getNeaLlmCredential(input.organizationId),
  ]);
  // Ya se sabe que la conversación y el perfil existen (el llamador los
  // validó antes de intentar el despacho); si de todos modos faltan —
  // desaparecieron entre medio— no hay a quién despacharle.
  if (!context || !profile) return null;

  const offers = offersRaw
    .filter((o) => Date.parse(o.startUtc) > now.getTime())
    .map((o) => ({ startUtc: o.startUtc, label: o.label }));

  const v1Payload = buildNeaPayload({
    organizationId: input.organizationId,
    conversationId: input.conversationId,
    isTest: input.isTest,
    contact: input.contact,
    messages: input.v1Messages,
  });

  const payload: NeaDispatchPayloadV2 = {
    ...v1Payload,
    version: 2,
    dispatchId: input.dispatchId,
    attempt: input.attempt,
    context,
    profile,
    history: historyResult.history,
    offers,
    // Nunca la clave de plataforma: getNeaLlmCredential solo lee ai_credentials.
    llm: llmCredential
      ? { provider: llmCredential.provider, model: llmCredential.model, apiKey: llmCredential.apiKey }
      : null,
  };

  return {
    payload,
    pendingIds: historyResult.pendingIds,
    orgCredential: llmCredential
      ? { provider: llmCredential.provider, keyIv: llmCredential.keyIv }
      : null,
  };
}

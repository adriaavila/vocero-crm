import { and, desc, eq, gt, inArray, ne, not } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { buildBotContext } from "@/server/bot/context";
import { buildBotProfile } from "@/server/bot/profile";
import { getOffers } from "@/server/agenda/offers";
import { getNeaLlmCredential } from "@/server/ai/credentials";
import {
  buildNeaPayload,
  type NeaDispatchPayloadV2,
  type NeaHistoryItem,
  type NeaHistoryRole,
  type NeaSourceMessage,
} from "@/server/ai/nea-dispatch";

/**
 * Ensamblado del snapshot que se despacha a Nea (dispatch v2). Se reconstruye
 * ENTERO en cada intento de `runNeaAgentTurn` — nunca se reusa uno viejo entre
 * reintentos, porque lo pendiente pudo cambiar mientras Nea no contestaba.
 */

const HISTORY_LIMIT = 20;
const PENDING_LIMIT = 10;
const MAX_TEXT_LEN = 2000;
const MAX_TRANSCRIPT_LEN = 4000;
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

type Db = ReturnType<typeof getDb>;

/**
 * El corte del conjunto pendiente: el MÁXIMO de
 *  - el cursor (`agent_cursor_at`, o si es NULL el último saliente `ai` no
 *    fallido — así una instancia que nunca tuvo cursor no reprocesa TODO el
 *    historial la primera vez que corre con dispatch v2);
 *  - `memory_reset_at` (un reset no debe dejar ver lo de antes);
 *  - el último saliente humano no fallido (operador/manual/plantilla) — un
 *    humano que ya contestó no debe verse "pendiente" para Nea;
 *  - `now - 24h` (la ventana de WhatsApp: no tiene sentido cargar más viejo).
 *
 * Exportada pura (sin BD) para poder probar cada candidato por separado.
 */
export function computePendingCutoff(input: {
  agentCursorAt: Date | null;
  lastAiOutboundAt: Date | null;
  memoryResetAt: Date | null;
  lastHumanOutboundAt: Date | null;
  now: Date;
}): Date {
  const cursor = input.agentCursorAt ?? input.lastAiOutboundAt ?? null;
  const dayAgo = new Date(input.now.getTime() - TWENTY_FOUR_HOURS_MS);
  // `!= null` a propósito: descarta tanto `null` (BD) como `undefined` (un
  // mock de prueba que no declaró el campo) — ningún candidato ausente debe
  // colarse hasta el `Math.max` de más abajo.
  const candidates = [cursor, input.memoryResetAt, input.lastHumanOutboundAt, dayAgo].filter(
    (d): d is Date => d != null
  );
  return new Date(Math.max(...candidates.map((d) => d.getTime())));
}

function roleFor(m: { direction: "in" | "out"; origin: string }): NeaHistoryRole {
  if (m.direction === "in") return "lead";
  if (m.origin === "ai") return "agent";
  if (m.origin === "manual") return "owner";
  return "team"; // operator, template
}

function truncate(s: string | null, max: number): string | null {
  if (s === null) return null;
  return s.length > max ? s.slice(0, max) : s;
}

type MessageRow = typeof schema.message.$inferSelect;
type MediaRow = typeof schema.mediaAsset.$inferSelect | null;
type JoinedRow = { message: MessageRow; media: MediaRow };

function toHistoryItem(row: JoinedRow, pendingIds: Set<string>): NeaHistoryItem {
  const { message, media } = row;
  return {
    id: message.id,
    role: roleFor(message),
    type: message.type,
    text: truncate(message.text, MAX_TEXT_LEN),
    at: (message.waTimestamp ?? message.createdAt).toISOString(),
    pending: pendingIds.has(message.id),
    media: media
      ? {
          mediaId: media.waMediaId,
          mime: media.mimeType,
          fileName: media.fileName,
          caption: media.caption,
          transcript: truncate(message.transcript, MAX_TRANSCRIPT_LEN),
          location: media.kind === "location" ? media.payload : null,
          contacts: media.kind === "contacts" ? media.payload : null,
        }
      : null,
  };
}

/** Trae mensajes + su adjunto (si tiene), más nuevo primero, ya invertidos a orden cronológico. */
async function fetchJoined(
  db: Db,
  conversationId: string,
  extra: NonNullable<ReturnType<typeof and>>,
  limit: number
): Promise<JoinedRow[]> {
  const rows = await db
    .select({ message: schema.message, media: schema.mediaAsset })
    .from(schema.message)
    .leftJoin(schema.mediaAsset, eq(schema.message.mediaAssetId, schema.mediaAsset.id))
    .where(and(eq(schema.message.conversationId, conversationId), extra))
    .orderBy(desc(schema.message.createdAt))
    .limit(limit);
  return rows.reverse();
}

/**
 * Arma `history` (últimos 20 desde `memory_reset_at`, sin los outbound
 * `failed`, con todo pendiente incluido aunque caiga fuera de esos 20) y el
 * conjunto pendiente (hasta 10 entrantes después del corte). Devuelve `null`
 * si no hay nada pendiente — señal de "no despachar".
 */
async function buildHistoryAndPending(input: {
  conversationId: string;
  memoryResetAt: Date | null;
  agentCursorAt: Date | null;
  now: Date;
}): Promise<{ history: NeaHistoryItem[]; maxPendingCreatedAt: Date } | null> {
  const db = getDb();
  const since = input.memoryResetAt ?? new Date(0);

  const [lastAiRows, lastHumanRows] = await Promise.all([
    db
      .select({ createdAt: schema.message.createdAt })
      .from(schema.message)
      .where(
        and(
          eq(schema.message.conversationId, input.conversationId),
          eq(schema.message.direction, "out"),
          eq(schema.message.origin, "ai"),
          ne(schema.message.status, "failed")
        )
      )
      .orderBy(desc(schema.message.createdAt))
      .limit(1),
    db
      .select({ createdAt: schema.message.createdAt })
      .from(schema.message)
      .where(
        and(
          eq(schema.message.conversationId, input.conversationId),
          eq(schema.message.direction, "out"),
          inArray(schema.message.origin, ["operator", "manual", "template"]),
          ne(schema.message.status, "failed")
        )
      )
      .orderBy(desc(schema.message.createdAt))
      .limit(1),
  ]);

  const cutoff = computePendingCutoff({
    agentCursorAt: input.agentCursorAt,
    lastAiOutboundAt: lastAiRows[0]?.createdAt ?? null,
    memoryResetAt: input.memoryResetAt,
    lastHumanOutboundAt: lastHumanRows[0]?.createdAt ?? null,
    now: input.now,
  });

  const pendingRows = await fetchJoined(
    db,
    input.conversationId,
    and(eq(schema.message.direction, "in"), gt(schema.message.createdAt, cutoff))!,
    PENDING_LIMIT
  );
  if (pendingRows.length === 0) return null;

  const pendingIds = new Set(pendingRows.map((r) => r.message.id));
  const maxPendingCreatedAt = pendingRows[pendingRows.length - 1]!.message.createdAt;

  // Solo se excluye un SALIENTE `failed`. Un entrante nunca se excluye por
  // status — en particular jamás un `pending` (`sendText` inserta la fila del
  // dueño/agente como `pending` ANTES de llamar a Graph; excluirlo borraría
  // del historial un mensaje que el cliente ya recibió).
  const historyRows = await fetchJoined(
    db,
    input.conversationId,
    and(
      gt(schema.message.createdAt, since),
      not(and(eq(schema.message.direction, "out"), eq(schema.message.status, "failed"))!)
    )!,
    HISTORY_LIMIT
  );

  const presentIds = new Set(historyRows.map((r) => r.message.id));
  const merged = [...historyRows];
  for (const p of pendingRows) {
    if (!presentIds.has(p.message.id)) merged.push(p);
  }
  merged.sort((a, b) => a.message.createdAt.getTime() - b.message.createdAt.getTime());

  return {
    history: merged.map((row) => toHistoryItem(row, pendingIds)),
    maxPendingCreatedAt,
  };
}

export type NeaTurnSnapshot = {
  payload: NeaDispatchPayloadV2;
  /** Para `agent_cursor_at = GREATEST(actual, esto)` tras un 2xx. */
  maxPendingCreatedAt: Date;
  /** El proveedor+`updated_at` de la credencial de org enviada (si hubo). */
  orgCredential: { provider: "openai" | "openrouter"; updatedAt: Date } | null;
};

/**
 * Ensambla el snapshot completo del turno. `null` ⇒ nada pendiente, el
 * llamador NO debe despachar.
 *
 * `v1Messages` se recibe ya seleccionado por el llamador (misma estrategia de
 * SIEMPRE — Laboratorio vs. conversación real, ver `pipeline.ts`): el campo
 * `messages` es v1 CONGELADO y no se deriva del conjunto pendiente nuevo.
 */
export async function buildNeaTurnSnapshot(input: {
  organizationId: string;
  conversationId: string;
  isTest: boolean;
  dispatchId: string;
  attempt: number;
  contact: { identity: string; name: string };
  memoryResetAt: Date | null;
  agentCursorAt: Date | null;
  v1Messages: NeaSourceMessage[];
}): Promise<NeaTurnSnapshot | null> {
  const now = new Date();
  const historyResult = await buildHistoryAndPending({
    conversationId: input.conversationId,
    memoryResetAt: input.memoryResetAt,
    agentCursorAt: input.agentCursorAt,
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
    maxPendingCreatedAt: historyResult.maxPendingCreatedAt,
    orgCredential: llmCredential
      ? { provider: llmCredential.provider, updatedAt: llmCredential.updatedAt }
      : null,
  };
}

import { and, asc, desc, eq, gt, inArray, isNull, ne, not, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import type { NeaHistoryItem, NeaHistoryRole } from "@/server/ai/nea-dispatch";

/**
 * Historial y conjunto pendiente del payload de dispatch v2 — en su propio
 * módulo (separado de `nea-payload.ts`) a propósito: es lo único de todo el
 * ensamblado que de verdad necesita SQL nativo (subconsultas, sin pasar por
 * un `Date` de JS) para no perder precisión, y separarlo permite mockearlo
 * como una unidad desde las pruebas de `buildNeaTurnSnapshot` — un
 * `vi.mock()` no puede interceptar una llamada que un módulo se hace a sí
 * mismo, así que esta función necesitaba vivir en OTRO archivo para ser
 * mockeable.
 */

const HISTORY_LIMIT = 20;
/** Exportado: `pipeline.ts` lo usa para saber si el pendiente de un intento
 *  pudo haberse cortado (fix-27b, `leftover` de `runNeaAgentTurn`) — si
 *  `pendingIds.length === PENDING_LIMIT`, puede haber más después del corte. */
export const PENDING_LIMIT = 10;
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
 * Exportada pura (sin BD) para poder probar la LÓGICA de cada candidato por
 * separado — pero el turno real NUNCA la llama para comparar. Ver
 * `pendingCutoffExpr` más abajo: comparar `message.created_at`
 * (microsegundos) contra el resultado de ESTA función (un `Date` de JS,
 * milisegundos) le hacía perder la parte fraccionaria al cursor, que se fija
 * EXACTO al `created_at` de un mensaje — el propio mensaje recién contestado
 * volvía a parecer "posterior al cursor" en el turno siguiente, y Nea sin
 * estado lo contestaba de nuevo cada vez. El cálculo real ocurre entero en
 * SQL, sin pasar jamás por un `Date` de JS.
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

/**
 * Una reserva viva (dispatch v2, `sendTextIdempotent`): se inserta en
 * `pending` SIN `wa_message_id` ANTES de llamar a Graph, y solo se completa
 * (o se borra, si Graph falla) después. Mientras está en ese hueco, Nea no
 * debe verla como si ya hubiera contestado — ni contarla como el último
 * saliente `ai` (fallback del cursor), ni en `history`, ni en
 * `agentHasSpoken` (`server/bot/context.ts` usa esta misma condición): un
 * envío que todavía puede fallar no es un hecho.
 *
 * Nunca excluye una fila del Laboratorio: `persistTestOutbound` inserta
 * siempre con `status:'sent'` (no hay paso de Graph que reservar), así que
 * `wa_message_id IS NULL AND status='pending'` no le aplica.
 */
function excludingLiveReservations(): ReturnType<typeof not> {
  return not(
    and(isNull(schema.message.waMessageId), eq(schema.message.status, "pending"))!
  );
}

/**
 * El mismo GREATEST de 4 candidatos que `computePendingCutoff`, pero como
 * fragmento SQL — `agent_cursor_at`/`memory_reset_at` se leen DENTRO de esta
 * misma expresión (subconsultas contra `conversation`), nunca se extraen a
 * un `Date` de JS antes de compararlos contra `message.created_at`. Es lo
 * único que de verdad evita la pérdida de precisión: un `Date` de JS es
 * indistinguible del real solo mientras nadie lo compara contra un
 * timestamp de microsegundos.
 */
function pendingCutoffExpr(
  db: Db,
  organizationId: string,
  conversationId: string,
  now: Date
): ReturnType<typeof sql> {
  const notLiveReservation = excludingLiveReservations();
  const lastAiSub = db
    .select({ v: schema.message.createdAt })
    .from(schema.message)
    .where(
      and(
        eq(schema.message.organizationId, organizationId),
        eq(schema.message.conversationId, conversationId),
        eq(schema.message.direction, "out"),
        eq(schema.message.origin, "ai"),
        ne(schema.message.status, "failed"),
        notLiveReservation
      )
    )
    .orderBy(desc(schema.message.createdAt))
    .limit(1);
  const lastHumanSub = db
    .select({ v: schema.message.createdAt })
    .from(schema.message)
    .where(
      and(
        eq(schema.message.organizationId, organizationId),
        eq(schema.message.conversationId, conversationId),
        eq(schema.message.direction, "out"),
        inArray(schema.message.origin, ["operator", "manual", "template"]),
        ne(schema.message.status, "failed")
      )
    )
    .orderBy(desc(schema.message.createdAt))
    .limit(1);

  return sql`greatest(
    coalesce(
      (select ${schema.conversation.agentCursorAt} from ${schema.conversation} where ${schema.conversation.id} = ${conversationId}),
      (${lastAiSub}),
      '-infinity'::timestamp
    ),
    coalesce(
      (select ${schema.conversation.memoryResetAt} from ${schema.conversation} where ${schema.conversation.id} = ${conversationId}),
      '-infinity'::timestamp
    ),
    coalesce((${lastHumanSub}), '-infinity'::timestamp),
    ${now.toISOString()}::timestamp - interval '24 hours'
  )`;
}

/** `memory_reset_at` como fragmento SQL — mismo motivo que `pendingCutoffExpr`. */
function memoryResetAtExpr(conversationId: string): ReturnType<typeof sql> {
  return sql`coalesce(
    (select ${schema.conversation.memoryResetAt} from ${schema.conversation} where ${schema.conversation.id} = ${conversationId}),
    '-infinity'::timestamp
  )`;
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
          // Payload de Meta SIN TRANSFORMAR (`message.contacts` del webhook de
          // WhatsApp) — ver el shape documentado en el tipo `NeaHistoryMedia`
          // (`server/ai/nea-dispatch.ts`). No se normaliza aquí.
          contacts: media.kind === "contacts" ? media.payload : null,
        }
      : null,
  };
}

/**
 * Trae mensajes + su adjunto (si tiene), más nuevo primero, ya invertidos a
 * orden cronológico. `organizationId` viaja SIEMPRE en el WHERE — no solo
 * por soberanía de tenant (Constitución III), sino porque sin él la consulta
 * no puede usar `message_org_conv_idx` (organization_id, conversation_id,
 * created_at) y termina recorriendo la tabla entera en una organización con
 * mucho volumen.
 */
async function fetchJoined(
  db: Db,
  organizationId: string,
  conversationId: string,
  extra: NonNullable<ReturnType<typeof and>>,
  limit: number,
  /**
   * "newest" (default, para `history`): los N MÁS RECIENTES, devueltos en
   * orden cronológico — correcto para "los últimos N de contexto".
   * "oldest" (para `pending`, fix-27b): los N MÁS VIEJOS después del corte —
   * un `ORDER BY created_at DESC LIMIT N` para el pendiente descartaba en
   * SILENCIO los mensajes más viejos cuando había más de N; con "oldest" se
   * toman esos primero, y los que sobren quedan pendientes para el próximo
   * turno (el cursor solo avanza hasta el más viejo de los que de verdad se
   * despacharon) — la cola drena en orden, nunca salta mensajes.
   */
  order: "newest" | "oldest" = "newest"
): Promise<JoinedRow[]> {
  const rows = await db
    .select({ message: schema.message, media: schema.mediaAsset })
    .from(schema.message)
    .leftJoin(schema.mediaAsset, eq(schema.message.mediaAssetId, schema.mediaAsset.id))
    .where(
      and(
        eq(schema.message.organizationId, organizationId),
        eq(schema.message.conversationId, conversationId),
        extra
      )
    )
    .orderBy(order === "newest" ? desc(schema.message.createdAt) : asc(schema.message.createdAt))
    .limit(limit);
  return order === "newest" ? rows.reverse() : rows;
}

/**
 * Arma `history` (últimos 20 desde `memory_reset_at`, sin los outbound
 * `failed`, con todo pendiente incluido aunque caiga fuera de esos 20) y el
 * conjunto pendiente (hasta 10 entrantes después del corte — los 10 MÁS
 * VIEJOS, nunca los más nuevos: si hay más de 10, los que sobran quedan
 * pendientes para el próximo turno en vez de perderse — ver el comentario de
 * `order` en `fetchJoined`). Devuelve `null` si no hay nada pendiente — señal
 * de "no despachar".
 *
 * `memory_reset_at`/`agent_cursor_at` NUNCA se reciben como parámetro: se
 * leen frescos, DENTRO de la propia consulta SQL, en cada llamada — ver
 * `pendingCutoffExpr`/`memoryResetAtExpr`. `pendingIds` (NO un `Date`) es lo
 * que se devuelve para avanzar el cursor después — ver el comentario en
 * `advanceCursor` (`pipeline.ts`).
 */
export async function buildHistoryAndPending(input: {
  organizationId: string;
  conversationId: string;
  now: Date;
}): Promise<{ history: NeaHistoryItem[]; pendingIds: string[] } | null> {
  const db = getDb();
  const { organizationId, conversationId, now } = input;
  const notLiveReservation = excludingLiveReservations();

  const cutoffExpr = pendingCutoffExpr(db, organizationId, conversationId, now);
  const sinceExpr = memoryResetAtExpr(conversationId);

  const pendingRows = await fetchJoined(
    db,
    organizationId,
    conversationId,
    and(eq(schema.message.direction, "in"), gt(schema.message.createdAt, cutoffExpr))!,
    PENDING_LIMIT,
    "oldest"
  );
  if (pendingRows.length === 0) return null;

  const pendingIds = pendingRows.map((r) => r.message.id);
  const pendingIdSet = new Set(pendingIds);

  // Se excluye un SALIENTE `failed` y una reserva viva sin wamid — ninguno es
  // todavía un hecho consumado. Un entrante nunca se excluye por status — en
  // particular jamás un `pending` (`sendText` inserta la fila del dueño/
  // agente como `pending` ANTES de llamar a Graph; excluirlo borraría del
  // historial un mensaje que el cliente ya recibió).
  const historyRows = await fetchJoined(
    db,
    organizationId,
    conversationId,
    and(
      gt(schema.message.createdAt, sinceExpr),
      not(and(eq(schema.message.direction, "out"), eq(schema.message.status, "failed"))!),
      notLiveReservation
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
    history: merged.map((row) => toHistoryItem(row, pendingIdSet)),
    pendingIds,
  };
}

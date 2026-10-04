import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { describeSendError } from "@/lib/meta/send-errors";
import { publish } from "@/server/events/bus";
import type { WebhookStatus } from "@/server/inbox/webhook";

/** Orden monotónico de estados: nunca degradar (un delivered tardío no pisa read). */
const STATUS_RANK: Record<string, number> = {
  pending: 0,
  sent: 1,
  delivered: 2,
  read: 3,
};

type MessageStatus = "pending" | "sent" | "delivered" | "read" | "failed";

export function isUpgrade(current: string, next: string): boolean {
  if (next === "failed") return current !== "failed";
  const c = STATUS_RANK[current];
  const n = STATUS_RANK[next];
  if (c === undefined || n === undefined) return false;
  return n > c;
}

/** Columna de `message` que guarda cuándo Meta confirmó cada estado. */
const STATUS_AT_COLUMN = {
  sent: "sentAt",
  delivered: "deliveredAt",
  read: "readAt",
  failed: "failedAt",
} as const;

type StatusAtColumn = (typeof STATUS_AT_COLUMN)[keyof typeof STATUS_AT_COLUMN];

type StatusSnapshot = {
  status: string;
} & Record<StatusAtColumn, Date | null>;

/** Segundos unix del webhook → Date; null si falta o no es un número válido. */
function statusTimestamp(timestamp: string | undefined): Date | null {
  const n = Number(timestamp);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000) : null;
}

/**
 * Qué escribir en el mensaje por un `status` del webhook. El estado solo sube
 * (monotónico), pero la marca de tiempo de ESE estado se llena siempre que
 * esté vacía: un `delivered` tardío después de `read` no cambia `status`, e
 * igual deja `delivered_at`. Vacío ⇒ nada que escribir.
 */
export function statusPatch(
  current: StatusSnapshot,
  status: WebhookStatus
): { status?: MessageStatus; at?: { column: StatusAtColumn; value: Date } } {
  const next = status.status;
  const patch: { status?: MessageStatus; at?: { column: StatusAtColumn; value: Date } } = {};
  if (isUpgrade(current.status, next)) patch.status = next as MessageStatus;
  const column = STATUS_AT_COLUMN[next as keyof typeof STATUS_AT_COLUMN];
  const at = statusTimestamp(status.timestamp);
  if (column && at && !current[column]) patch.at = { column, value: at };
  return patch;
}

/**
 * - `applied`: había mensaje y se escribió algo.
 * - `ignored`: había mensaje pero el evento no cambia nada (repetido, tardío
 *   con la marca ya llena, estado desconocido).
 * - `unmatched`: ningún mensaje con ese wamid (el envío aún no lo guardó, o el
 *   número no es nuestro): el raw_event queda `unmatched` para el replay.
 */
export type StatusOutcome = "applied" | "ignored" | "unmatched";

export async function applyStatusUpdate(
  organizationId: string,
  status: WebhookStatus
): Promise<StatusOutcome> {
  const next = status.status;
  if (!(next in STATUS_RANK) && next !== "failed") return "ignored"; // estado desconocido

  const db = getDb();
  const rows = await db
    .select({
      id: schema.message.id,
      conversationId: schema.message.conversationId,
      status: schema.message.status,
      sentAt: schema.message.sentAt,
      deliveredAt: schema.message.deliveredAt,
      readAt: schema.message.readAt,
      failedAt: schema.message.failedAt,
    })
    .from(schema.message)
    .where(
      and(
        eq(schema.message.organizationId, organizationId),
        eq(schema.message.waMessageId, status.id)
      )
    )
    .limit(1);
  const msg = rows[0];
  if (!msg) return "unmatched";

  const patch = statusPatch(msg, status);
  if (!patch.status && !patch.at) return "ignored";

  const failure = status.errors?.[0];
  const error =
    patch.status === "failed"
      ? describeSendError(failure?.code, failure?.message ?? failure?.title)
      : null;

  await db
    .update(schema.message)
    .set({
      ...(patch.status ? { status: patch.status, error } : {}),
      ...(patch.at ? { [patch.at.column]: patch.at.value } : {}),
    })
    .where(eq(schema.message.id, msg.id));

  if (patch.status) {
    publish(organizationId, {
      type: "message.status",
      data: {
        conversationId: msg.conversationId,
        messageId: msg.id,
        status: patch.status,
        // Sin esto el operador ve el triángulo de fallo pero nunca el motivo.
        error,
      },
    });
  }
  return "applied";
}

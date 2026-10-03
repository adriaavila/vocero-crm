import { and, asc, eq, gte, inArray, isNull, ne, or, sql, type SQL } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";

/**
 * Data spine — acceso a la tabla `raw_event`. Solo SQL: la lógica (enrutar,
 * procesar, decidir qué se repite) vive en `raw-events.ts`. Está separado para
 * que esa lógica se pruebe con una tienda en memoria, sin Postgres.
 */

export type RawEventRow = typeof schema.rawEvent.$inferSelect;
export type RawEventStatus = RawEventRow["status"];

export type NewRawEvent = {
  channel: string;
  organizationId: string | null;
  accountRef: string | null;
  field: string;
  dedupeKey: string;
  payload: unknown;
  /** Un evento ilegible nace ya `failed`; el resto, `pending`. */
  status?: RawEventStatus;
  error?: string | null;
};

/**
 * Inserta el evento, o devuelve el que ya existe con el mismo `dedupe_key`
 * (un reintento de Meta). `created` dice cuál de los dos pasó.
 */
export async function insertRawEvent(
  input: NewRawEvent
): Promise<{ row: RawEventRow; created: boolean }> {
  const db = getDb();
  const inserted = await db
    .insert(schema.rawEvent)
    .values({
      id: newId("rawEvent"),
      channel: input.channel,
      organizationId: input.organizationId,
      accountRef: input.accountRef,
      field: input.field,
      dedupeKey: input.dedupeKey,
      payload: input.payload,
      status: input.status ?? "pending",
      error: input.error ?? null,
    })
    .onConflictDoNothing({ target: schema.rawEvent.dedupeKey })
    .returning();
  if (inserted[0]) return { row: inserted[0], created: true };

  const existing = await db
    .select()
    .from(schema.rawEvent)
    .where(eq(schema.rawEvent.dedupeKey, input.dedupeKey))
    .limit(1);
  if (!existing[0]) throw new Error("raw_event desapareció tras el conflicto de dedupe_key");
  return { row: existing[0], created: false };
}

/**
 * Cierra un intento de proceso: cuenta el intento, deja el estado y, si por fin
 * se enrutó, la organización. `processed_at` solo se marca en los estados
 * terminales (`processed`, `ignored`).
 */
export async function finishRawEvent(
  id: string,
  result: { status: RawEventStatus; error?: string | null; organizationId?: string | null }
): Promise<void> {
  const terminal = result.status === "processed" || result.status === "ignored";
  await getDb()
    .update(schema.rawEvent)
    .set({
      status: result.status,
      error: result.error ?? null,
      attempts: sql`${schema.rawEvent.attempts} + 1`,
      ...(terminal ? { processedAt: new Date() } : {}),
      ...(result.organizationId ? { organizationId: result.organizationId } : {}),
    })
    .where(eq(schema.rawEvent.id, id));
}

export type ReplayFilter = {
  organizationId?: string;
  /**
   * Con `organizationId`: las referencias de cuenta (phone_number_id / WABA)
   * de esa organización, para recoger también lo que llegó SIN enrutar
   * (`organization_id` null) cuando el número todavía no estaba conectado.
   */
  accountRefs?: string[];
  statuses: RawEventStatus[];
  since?: Date;
  limit: number;
};

/** Los eventos a repetir, del más viejo al más nuevo (el orden en que llegaron). */
export async function listReplayableRawEvents(filter: ReplayFilter): Promise<RawEventRow[]> {
  const conditions: (SQL | undefined)[] = [
    inArray(schema.rawEvent.status, filter.statuses),
    // Un cuerpo ilegible no tiene qué reprocesar.
    ne(schema.rawEvent.field, "_unparsed"),
    filter.since ? gte(schema.rawEvent.receivedAt, filter.since) : undefined,
  ];

  const base = and(...conditions.filter((c): c is SQL => c !== undefined))!;
  let where = base;
  if (filter.organizationId) {
    const own = scoped(schema.rawEvent.organizationId, filter.organizationId);
    const refs = filter.accountRefs ?? [];
    const unrouted =
      refs.length > 0
        ? and(isNull(schema.rawEvent.organizationId), inArray(schema.rawEvent.accountRef, refs))
        : undefined;
    where = and(base, unrouted ? or(own, unrouted) : own)!;
  }

  return getDb()
    .select()
    .from(schema.rawEvent)
    .where(where)
    .orderBy(asc(schema.rawEvent.receivedAt), asc(schema.rawEvent.id))
    .limit(filter.limit);
}

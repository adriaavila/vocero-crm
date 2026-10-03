import type {
  NewRawEvent,
  RawEventRow,
  RawEventStatus,
  ReplayFilter,
} from "@/server/agencia/raw-events-store";

/**
 * Tienda en memoria de `raw_event` con la misma semántica que la de Postgres
 * (dedupe por `dedupe_key`, `attempts + 1` por intento, `processed_at` solo en
 * estados terminales). Deja probar el orquestador sin base de datos; la tabla
 * real se prueba en data-spine-realdb.test.ts.
 */
export const memoryStore = {
  rows: [] as RawEventRow[],
  /** Hace fallar el siguiente insert (BD caída, payload venenoso…). */
  failNextInsert: false,
  reset() {
    this.rows.length = 0;
    this.failNextInsert = false;
  },
  byField(field: string) {
    return this.rows.filter((r) => r.field === field);
  },
};

export const memoryStoreModule = {
  async insertRawEvent(input: NewRawEvent) {
    if (memoryStore.failNextInsert) {
      memoryStore.failNextInsert = false;
      throw new Error("insert failed");
    }
    const existing = memoryStore.rows.find((r) => r.dedupeKey === input.dedupeKey);
    if (existing) return { row: existing, created: false };
    const row: RawEventRow = {
      id: `rev_mem${memoryStore.rows.length + 1}`,
      organizationId: input.organizationId,
      channel: input.channel,
      accountRef: input.accountRef,
      field: input.field,
      dedupeKey: input.dedupeKey,
      payload: input.payload,
      receivedAt: new Date(Date.now() + memoryStore.rows.length),
      processedAt: null,
      status: input.status ?? "pending",
      attempts: 0,
      error: input.error ?? null,
    };
    memoryStore.rows.push(row);
    return { row, created: true };
  },

  async finishRawEvent(
    id: string,
    result: { status: RawEventStatus; error?: string | null; organizationId?: string | null }
  ) {
    const row = memoryStore.rows.find((r) => r.id === id);
    if (!row) return;
    row.status = result.status;
    row.error = result.error ?? null;
    row.attempts += 1;
    if (result.status === "processed" || result.status === "ignored") row.processedAt = new Date();
    if (result.organizationId) row.organizationId = result.organizationId;
  },

  async listReplayableRawEvents(filter: ReplayFilter) {
    return memoryStore.rows
      .filter((r) => filter.statuses.includes(r.status) && r.field !== "_unparsed")
      .filter((r) => !filter.since || r.receivedAt >= filter.since)
      .filter(
        (r) =>
          !filter.organizationId ||
          r.organizationId === filter.organizationId ||
          (r.organizationId === null && !!r.accountRef && (filter.accountRefs ?? []).includes(r.accountRef))
      )
      .sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime())
      .slice(0, filter.limit);
  },
};

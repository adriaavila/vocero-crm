import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Data spine — cuándo confirmó Meta cada estado. El rango (`status`) sigue
 * siendo monotónico; las marcas `sent_at` / `delivered_at` / `read_at` /
 * `failed_at` se llenan aunque el estado no suba. La tabla real:
 * data-spine-realdb.test.ts.
 */

const state = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  updates: [] as Record<string, unknown>[],
  published: [] as unknown[],
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => {
      const c: Record<string, unknown> = {};
      for (const m of ["from", "where"]) c[m] = () => c;
      c.limit = () => Promise.resolve(state.rows);
      return c;
    },
    update: () => ({
      set: (values: Record<string, unknown>) => {
        state.updates.push(values);
        return { where: () => Promise.resolve() };
      },
    }),
  }),
  schema: new Proxy(
    {},
    { get: (_t, table) => new Proxy({}, { get: (_t2, col) => `${String(table)}.${String(col)}` }) }
  ),
}));
vi.mock("@/server/events/bus", () => ({ publish: (...args: unknown[]) => state.published.push(args) }));

import { applyStatusUpdate, statusPatch } from "@/server/inbox/status";

const T = (s: number) => new Date(s * 1000);
const empty = { sentAt: null, deliveredAt: null, readAt: null, failedAt: null };
// Meta siempre manda `timestamp`; el cast deja probar uno ausente.
const st = (status: string, timestamp: string | undefined) => ({ id: "wamid.1", status, timestamp: timestamp as string });

describe("statusPatch", () => {
  it("sent → delivered → read: sube el estado y llena la marca de cada uno con el timestamp de Meta", () => {
    expect(statusPatch({ status: "pending", ...empty }, st("sent", "100"))).toEqual({
      status: "sent",
      at: { column: "sentAt", value: T(100) },
    });
    expect(statusPatch({ status: "sent", ...empty, sentAt: T(100) }, st("delivered", "105"))).toEqual({
      status: "delivered",
      at: { column: "deliveredAt", value: T(105) },
    });
    expect(
      statusPatch({ status: "delivered", ...empty, sentAt: T(100), deliveredAt: T(105) }, st("read", "190"))
    ).toEqual({ status: "read", at: { column: "readAt", value: T(190) } });
  });

  it("un delivered TARDÍO después de read no baja el estado pero sí llena delivered_at si estaba vacío", () => {
    const patch = statusPatch({ status: "read", ...empty, readAt: T(190) }, st("delivered", "105"));
    expect(patch).toEqual({ at: { column: "deliveredAt", value: T(105) } });
    expect(patch.status).toBeUndefined();
  });

  it("un delivered repetido con la marca ya llena no cambia nada (la primera marca gana)", () => {
    expect(statusPatch({ status: "delivered", ...empty, deliveredAt: T(105) }, st("delivered", "999"))).toEqual({});
  });

  it("failed aplica desde cualquier estado y deja failed_at", () => {
    expect(statusPatch({ status: "read", ...empty }, st("failed", "300"))).toEqual({
      status: "failed",
      at: { column: "failedAt", value: T(300) },
    });
    expect(statusPatch({ status: "failed", ...empty, failedAt: T(300) }, st("failed", "301"))).toEqual({});
  });

  it("un estado desconocido o un timestamp inválido no inventan nada", () => {
    expect(statusPatch({ status: "sent", ...empty }, st("warning", "100"))).toEqual({});
    expect(statusPatch({ status: "pending", ...empty }, st("sent", undefined))).toEqual({ status: "sent" });
    expect(statusPatch({ status: "pending", ...empty }, st("sent", "abc"))).toEqual({ status: "sent" });
    expect(statusPatch({ status: "pending", ...empty }, st("sent", "0"))).toEqual({ status: "sent" });
  });
});

describe("applyStatusUpdate", () => {
  beforeEach(() => {
    state.rows = [];
    state.updates.length = 0;
    state.published.length = 0;
  });

  it("wamid sin mensaje → unmatched y no escribe nada (queda para el replay)", async () => {
    await expect(applyStatusUpdate("org_1", st("sent", "100"))).resolves.toBe("unmatched");
    expect(state.updates).toHaveLength(0);
  });

  it("estado desconocido → ignored sin tocar la BD", async () => {
    await expect(applyStatusUpdate("org_1", st("warning", "100"))).resolves.toBe("ignored");
    expect(state.updates).toHaveLength(0);
  });

  it("un delivered nuevo → applied, escribe estado y marca, y avisa a la bandeja", async () => {
    state.rows = [{ id: "msg_1", conversationId: "cv_1", status: "sent", ...empty, sentAt: T(100) }];
    await expect(applyStatusUpdate("org_1", st("delivered", "105"))).resolves.toBe("applied");
    expect(state.updates).toEqual([{ status: "delivered", error: null, deliveredAt: T(105) }]);
    expect(state.published).toHaveLength(1);
  });

  it("un delivered tardío tras read → applied pero SIN cambiar el estado y SIN evento a la bandeja", async () => {
    state.rows = [{ id: "msg_1", conversationId: "cv_1", status: "read", ...empty, readAt: T(190) }];
    await expect(applyStatusUpdate("org_1", st("delivered", "105"))).resolves.toBe("applied");
    expect(state.updates).toEqual([{ deliveredAt: T(105) }]);
    expect(state.published).toHaveLength(0);
  });

  it("un evento que no cambia nada → ignored", async () => {
    state.rows = [{ id: "msg_1", conversationId: "cv_1", status: "read", ...empty, deliveredAt: T(105) }];
    await expect(applyStatusUpdate("org_1", st("delivered", "999"))).resolves.toBe("ignored");
    expect(state.updates).toHaveLength(0);
  });

  it("failed: guarda el motivo traducido junto al estado", async () => {
    state.rows = [{ id: "msg_1", conversationId: "cv_1", status: "sent", ...empty }];
    await applyStatusUpdate("org_1", {
      id: "wamid.1",
      status: "failed",
      timestamp: "300",
      errors: [{ code: 131047, message: "Re-engagement message" }],
    });
    expect(state.updates[0]).toMatchObject({ status: "failed", failedAt: T(300) });
    expect(typeof state.updates[0]!.error).toBe("string");
  });
});

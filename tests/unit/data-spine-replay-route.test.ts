import { beforeEach, describe, expect, it, vi } from "vitest";

/** POST /api/saas/raw-events/replay: solo el admin SaaS, validado y auditado. */

const mocks = vi.hoisted(() => ({
  requireSaaSAdminIdentity: vi.fn(),
  auditSaaSAdminAction: vi.fn(),
  replayRawEvents: vi.fn(),
  orgRows: [] as { id: string }[],
}));

vi.mock("@/server/saas/admin", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/saas/admin")>()),
  requireSaaSAdminIdentity: mocks.requireSaaSAdminIdentity,
  auditSaaSAdminAction: mocks.auditSaaSAdminAction,
}));
vi.mock("@/server/agencia/raw-events", () => ({ replayRawEvents: mocks.replayRawEvents }));
vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => {
      const c: Record<string, unknown> = {};
      for (const m of ["from", "where"]) c[m] = () => c;
      c.limit = () => Promise.resolve(mocks.orgRows);
      return c;
    },
  }),
  schema: { organization: { id: "organization.id" } },
}));

import { SaaSAdminUnauthorized } from "@/server/saas/admin";
import { POST } from "@/app/api/saas/raw-events/replay/route";

const SUMMARY = { scanned: 3, processed: 2, unrouted: 1, unmatched: 0, ignored: 0, failed: 0 };
const post = (body: unknown) =>
  POST(new Request("http://admin/api/saas/raw-events/replay", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.orgRows = [{ id: "org_1" }];
  mocks.requireSaaSAdminIdentity.mockResolvedValue({ userId: "usr_admin", email: "a@allok.fun", name: "A" });
  mocks.replayRawEvents.mockResolvedValue(SUMMARY);
});

describe("POST /api/saas/raw-events/replay", () => {
  it("quien no es admin SaaS recibe 404 y no se reprocesa nada", async () => {
    mocks.requireSaaSAdminIdentity.mockRejectedValue(new SaaSAdminUnauthorized());
    const res = await post({});
    expect(res.status).toBe(404);
    expect(mocks.replayRawEvents).not.toHaveBeenCalled();
    expect(mocks.auditSaaSAdminAction).not.toHaveBeenCalled();
  });

  it("sin body usa los defaults, devuelve el resumen y deja la auditoría", async () => {
    const res = await post({});

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(SUMMARY);
    expect(mocks.replayRawEvents).toHaveBeenCalledWith({
      organizationId: undefined,
      statuses: undefined,
      since: undefined,
      limit: undefined,
    });
    expect(mocks.auditSaaSAdminAction).toHaveBeenCalledWith({
      userId: "usr_admin",
      action: "replay_raw_events",
      organizationId: null,
      detail: { statuses: null, since: null, limit: null, ...SUMMARY },
    });
  });

  it("pasa organización, estados, desde y límite ya validados", async () => {
    await post({ organizationId: "org_1", statuses: ["unrouted"], since: "2026-10-01T00:00:00.000Z", limit: 50 });

    expect(mocks.replayRawEvents).toHaveBeenCalledWith({
      organizationId: "org_1",
      statuses: ["unrouted"],
      since: new Date("2026-10-01T00:00:00.000Z"),
      limit: 50,
    });
    expect(mocks.auditSaaSAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org_1" })
    );
  });

  it("404 si la organización no existe (y no se audita contra una FK inexistente)", async () => {
    mocks.orgRows = [];
    const res = await post({ organizationId: "org_fantasma" });
    expect(res.status).toBe(404);
    expect(mocks.replayRawEvents).not.toHaveBeenCalled();
  });

  it.each([
    ["un estado fuera de catálogo", { statuses: ["processed"] }],
    ["estados vacíos", { statuses: [] }],
    ["un límite enorme", { limit: 100000 }],
    ["un límite 0", { limit: 0 }],
    ["una fecha inválida", { since: "ayer" }],
    ["campos de más", { dryRun: true }],
  ])("422 con %s", async (_n, body) => {
    const res = await post(body);
    expect(res.status).toBe(422);
    expect(mocks.replayRawEvents).not.toHaveBeenCalled();
  });
});

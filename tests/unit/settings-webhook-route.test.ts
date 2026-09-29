import { beforeEach, describe, expect, it, vi } from "vitest";

/** GET /api/settings/webhook: owner-only, y 404 completo en modo SaaS (item 5 del review). */

const { requireSession } = vi.hoisted(() => ({ requireSession: vi.fn() }));
vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/session")>()),
  requireSession,
}));

let saasMode = false;
vi.mock("@/lib/tenant-host", () => ({ isAllokSaaSMode: () => saasMode }));

vi.mock("@/lib/env", () => ({
  getEnv: () => ({
    APP_BASE_URL: "http://localhost:3311",
    META_WEBHOOK_VERIFY_TOKEN: "verify-test",
    META_APP_SECRET: "secret",
  }),
}));

vi.mock("@/server/channels/enabled", () => ({ isChannelEnabled: () => false }));

beforeEach(() => {
  requireSession.mockReset();
  saasMode = false;
});

describe("GET /api/settings/webhook", () => {
  it("responde 403 a un miembro sin rol owner", async () => {
    requireSession.mockResolvedValue({ userId: "member", organizationId: "org", role: "member" });
    const { GET } = await import("@/app/api/settings/webhook/route");
    const response = await GET();
    expect(response.status).toBe(403);
  });

  it("responde 200 con la URL del webhook para el owner, fuera de SaaS", async () => {
    requireSession.mockResolvedValue({ userId: "owner", organizationId: "org", role: "owner" });
    const { GET } = await import("@/app/api/settings/webhook/route");
    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.url).toContain("verify-test");
  });

  it("responde 404 en modo SaaS, incluso para el owner (el override es automático)", async () => {
    saasMode = true;
    requireSession.mockResolvedValue({ userId: "owner", organizationId: "org", role: "owner" });
    const { GET } = await import("@/app/api/settings/webhook/route");
    const response = await GET();
    expect(response.status).toBe(404);
  });
});

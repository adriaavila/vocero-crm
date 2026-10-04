import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const create = vi.fn(async () => ({ url: "https://portal.test/s" }));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  withOwner: (handler: (session: unknown, ...args: unknown[]) => Promise<Response>) =>
    (...args: unknown[]) => handler({ organizationId: "org_1", role: "owner" }, ...args),
}));
vi.mock("@/server/saas/billing", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/saas/billing")>()),
  stripeForSaaS: () => ({ billingPortal: { sessions: { create } } }),
  getOrganizationBilling: async () => ({ customerId: "cus_1" }),
  getOrganizationForBilling: async () => ({ id: "org_1", name: "Taller", slug: "taller", metadata: null }),
}));

import { POST } from "@/app/api/saas/billing/portal/route";

const open = () =>
  (POST as (request: Request) => Promise<Response>)(new Request("http://localhost/api/saas/billing/portal", { method: "POST" }));

describe("POST /api/saas/billing/portal", () => {
  beforeEach(() => create.mockClear());
  afterEach(() => vi.unstubAllEnvs());

  it("uses the dedicated portal configuration when ALLOK_SAAS_STRIPE_PORTAL_CONFIG_ID is set", async () => {
    vi.stubEnv("ALLOK_SAAS_STRIPE_PORTAL_CONFIG_ID", "bpc_saas");
    expect((await open()).status).toBe(200);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ customer: "cus_1", configuration: "bpc_saas" }));
  });

  it("falls back to the account default when it is unset or blank", async () => {
    vi.stubEnv("ALLOK_SAAS_STRIPE_PORTAL_CONFIG_ID", " ");
    await open();
    const args = (create.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(args).not.toHaveProperty("configuration");
  });
});

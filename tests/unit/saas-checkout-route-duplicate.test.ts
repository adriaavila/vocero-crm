import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const stripe = {
  subscriptions: { list: vi.fn() },
  customers: { create: vi.fn() },
  checkout: { sessions: { create: vi.fn() } },
};
const billingRow = { customerId: "cus_1" as string | null };

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  withOwner: (handler: (session: unknown, ...args: unknown[]) => Promise<Response>) =>
    (...args: unknown[]) => handler({ organizationId: "org_1", role: "owner" }, ...args),
}));
vi.mock("@/server/saas/billing", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/saas/billing")>()),
  stripeForSaaS: () => stripe,
  priceIdForPlan: () => "price_pro",
  getOrganizationForBilling: async () => ({ id: "org_1", name: "Taller", slug: "taller", metadata: null }),
  getOrganizationBilling: async () => ({
    plan: null, status: "inactive", customerId: billingRow.customerId, subscriptionId: null, priceId: null,
    currentPeriodEnd: null, cancelAtPeriodEnd: false, updatedAt: null, source: null, grantedBy: null,
    grantedAt: null, detachedSubscriptionId: null,
  }),
  saveOrganizationBilling: vi.fn(async () => ({})),
}));

import { POST } from "@/app/api/saas/billing/checkout/route";

function post() {
  return (POST as (request: Request) => Promise<Response>)(
    new Request("http://localhost/api/saas/billing/checkout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ plan: "pro" }),
    }),
  );
}

describe("POST /api/saas/billing/checkout with a Stripe customer that already subscribed", () => {
  beforeEach(() => {
    vi.stubEnv("SAAS_PLANS", "basic,pro");
    billingRow.customerId = "cus_1";
    stripe.subscriptions.list.mockReset();
    stripe.checkout.sessions.create.mockReset().mockResolvedValue({ url: "https://checkout.test/s" });
  });
  afterEach(() => vi.unstubAllEnvs());

  it.each(["active", "trialing", "past_due", "incomplete"])("refuses with 409 when a %s subscription exists", async (status) => {
    stripe.subscriptions.list.mockResolvedValue({ data: [{ id: "sub_1", status }] });
    const response = await post();
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: "subscription_exists", message: "Ya tienes una suscripción. Gestiónala en el portal." },
    });
    expect(stripe.subscriptions.list).toHaveBeenCalledWith({ customer: "cus_1", status: "all", limit: 10 });
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("opens Checkout when every previous subscription is over", async () => {
    stripe.subscriptions.list.mockResolvedValue({ data: [{ id: "sub_old", status: "canceled" }] });
    const response = await post();
    expect(response.status).toBe(200);
    expect(stripe.checkout.sessions.create).toHaveBeenCalledOnce();
  });

  it("does not ask Stripe for subscriptions when the org has no customer yet", async () => {
    billingRow.customerId = null;
    stripe.customers.create.mockResolvedValue({ id: "cus_new" });
    const response = await post();
    expect(response.status).toBe(200);
    expect(stripe.subscriptions.list).not.toHaveBeenCalled();
  });
});

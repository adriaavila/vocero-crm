import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const org = { metadata: null as string | null };
let inTransaction = 0;
let lockedReads = 0;

const orgRows = () => [{ id: "org_1", name: "Taller", slug: "taller", metadata: org.metadata }];
const select = () => {
  const chain: Record<string, unknown> = {
    then: (resolve: (value: unknown[]) => unknown) => Promise.resolve(orgRows()).then(resolve),
  };
  chain.from = () => chain;
  chain.where = () => chain;
  chain.limit = () => chain;
  chain.for = () => {
    lockedReads += 1;
    return chain;
  };
  return chain;
};
const db = {
  select,
  update: () => ({
    set: (patch: { metadata: string }) => ({
      where: async () => {
        org.metadata = patch.metadata;
      },
    }),
  }),
  transaction: async (run: (tx: unknown) => Promise<unknown>) => {
    inTransaction += 1;
    try {
      return await run(db);
    } finally {
      inTransaction -= 1;
    }
  },
};
let event: unknown;
const stripe = {
  webhooks: { constructEvent: () => event },
  customers: { retrieve: vi.fn() },
};

vi.mock("@/lib/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db")>()),
  getDb: () => db,
}));
vi.mock("@/server/saas/billing", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/saas/billing")>()),
  stripeForSaaS: () => stripe,
  webhookSecretForSaaS: () => "whsec_test",
  hasRememberedBillingEvent: async () => false,
  rememberBillingEvent: async () => true,
}));

import { POST } from "@/app/api/saas/billing/webhook/route";
import { billingFromMetadata } from "@/server/saas/billing";

function setBilling(billing: Record<string, unknown>) {
  org.metadata = JSON.stringify({ allok: { billing } });
}
const billing = () => billingFromMetadata(org.metadata);

function send(type: string, object: Record<string, unknown>, created: number) {
  event = { id: `evt_${type}_${created}`, type, created, data: { object: { metadata: { organizationId: "org_1" }, ...object } } };
  return POST(new Request("http://localhost/api/saas/billing/webhook", {
    method: "POST",
    headers: { "stripe-signature": "sig" },
    body: "{}",
  }));
}
const subscription = (id: string, status: string) => ({
  id,
  status,
  customer: "cus_1",
  cancel_at_period_end: false,
  items: { data: [{ price: { id: "price_pro" }, current_period_end: 1_900_000_000 }] },
});

describe("POST /api/saas/billing/webhook", () => {
  beforeEach(() => {
    org.metadata = null;
    lockedReads = 0;
    vi.stubEnv("ALLOK_SAAS_STRIPE_PRO_PRICE_ID", "price_pro");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("checkout.session.completed after subscription.created keeps the status active", async () => {
    setBilling({ plan: "pro", status: "incomplete", customerId: "cus_1", updatedAt: "2026-10-01T00:00:00.000Z" });

    await send("customer.subscription.created", subscription("sub_1", "active"), 1_790_000_100);
    expect(billing()).toMatchObject({ status: "active", subscriptionId: "sub_1" });

    await send(
      "checkout.session.completed",
      { mode: "subscription", customer: "cus_1", subscription: "sub_1", metadata: { organizationId: "org_1", plan: "pro" } },
      1_790_000_200,
    );
    expect(billing()).toMatchObject({ status: "active", subscriptionId: "sub_1", plan: "pro" });
  });

  it("does the read-modify-write in one transaction on the locked row", async () => {
    await send("invoice.paid", { customer: "cus_1", parent: { subscription_details: { subscription: "sub_1" } } }, 1_790_000_100);
    expect(lockedReads).toBe(1);
    expect(inTransaction).toBe(0);
  });

  it("ignores subscription and invoice events of the detached subscription", async () => {
    setBilling({ plan: "pro", status: "active", source: "manual_2026-10-01", subscriptionId: null, detachedSubscriptionId: "sub_old", updatedAt: "2026-10-01T00:00:00.000Z" });

    for (const [type, object] of [
      ["customer.subscription.updated", subscription("sub_old", "past_due")],
      ["customer.subscription.created", subscription("sub_old", "active")],
      ["invoice.payment_failed", { customer: "cus_1", subscription: "sub_old", parent: { subscription_details: { subscription: "sub_old" } } }],
      ["invoice.paid", { customer: "cus_1", subscription: "sub_old", parent: { subscription_details: { subscription: "sub_old" } } }],
    ] as const) {
      const body = await (await send(type, object, 1_790_000_300)).json();
      expect(body).toMatchObject({ ignored: true, stale_subscription: true });
    }
    expect(billing()).toMatchObject({ status: "active", subscriptionId: null, source: "manual_2026-10-01" });
  });

  it("logs at error level a second live subscription created for the same customer", async () => {
    setBilling({ plan: "pro", status: "active", customerId: "cus_1", subscriptionId: "sub_1", updatedAt: "2026-10-01T00:00:00.000Z" });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const body = await (await send("customer.subscription.created", subscription("sub_2", "active"), 1_790_000_400)).json();

    expect(body).toMatchObject({ ignored: true, stale_subscription: true });
    expect(billing().subscriptionId).toBe("sub_1");
    expect(error).toHaveBeenCalledWith(
      "[saas-billing] second live subscription for the same customer",
      expect.objectContaining({ organizationId: "org_1", currentSubscriptionId: "sub_1", newSubscriptionId: "sub_2" }),
    );
  });
});

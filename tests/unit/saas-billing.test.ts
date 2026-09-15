import { afterEach, describe, expect, it, vi } from "vitest";
import {
  billingFromMetadata,
  mergeBillingState,
  planForPriceId,
  statusFromStripe,
  tenantOrigin,
  trialDaysForPlan,
} from "../../src/server/saas/billing";

describe("Allok SaaS billing", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("normaliza billing faltante sin activar automatización", () => {
    expect(billingFromMetadata(null)).toMatchObject({
      plan: null,
      status: "inactive",
      customerId: null,
    });
    expect(
      billingFromMetadata(JSON.stringify({ allok: { billing: { status: "active", plan: "pro" } } })),
    ).toMatchObject({ plan: "pro", status: "active" });
  });

  it("solo reconoce los Price IDs configurados para Basic y Pro", () => {
    vi.stubEnv("ALLOK_SAAS_STRIPE_BASIC_PRICE_ID", "price_basic_test");
    vi.stubEnv("ALLOK_SAAS_STRIPE_PRO_PRICE_ID", "price_pro_test");
    expect(planForPriceId("price_basic_test")).toBe("basic");
    expect(planForPriceId("price_pro_test")).toBe("pro");
    expect(planForPriceId("price_inventado")).toBeNull();
  });

  it("pausa estados que no deben automatizar", () => {
    expect(statusFromStripe("active")).toBe("active");
    expect(statusFromStripe("past_due")).toBe("past_due");
    expect(statusFromStripe("incomplete_expired")).toBe("inactive");
  });

  it("ignora eventos de Stripe que llegan fuera de orden", () => {
    const current = billingFromMetadata(JSON.stringify({ allok: { billing: {
      plan: "pro", status: "active", updatedAt: "2026-09-10T10:00:00.000Z",
    } } }));
    expect(mergeBillingState(current, {
      status: "past_due",
      updatedAt: "2026-09-10T09:59:00.000Z",
    })).toEqual(current);
  });

  it("acepta el primer webhook sobre el estado provisional de checkout", () => {
    const current = billingFromMetadata(JSON.stringify({ allok: { billing: {
      plan: "basic", status: "incomplete", updatedAt: "2026-09-10T10:00:00.000Z",
    } } }));
    expect(mergeBillingState(current, {
      status: "active",
      updatedAt: "2026-09-10T09:59:00.000Z",
    })).toMatchObject({ status: "active", plan: "basic" });
  });

  it("conserva el host local al devolver el subdominio del tenant", () => {
    const request = new Request("http://localhost:3000/api/saas/tenant", {
      headers: { "x-forwarded-host": "alpha.localhost:3000", "x-forwarded-proto": "http" },
    });
    expect(tenantOrigin("alpha", request)).toBe("http://alpha.localhost:3000");
  });

  it("sólo Pro lleva prueba gratis, y son 7 días", () => {
    expect(trialDaysForPlan("pro")).toBe(7);
    expect(trialDaysForPlan("basic")).toBeUndefined();
  });
});

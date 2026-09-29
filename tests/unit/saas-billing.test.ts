import { afterEach, describe, expect, it, vi } from "vitest";
import {
  billingFromMetadata,
  mergeBillingState,
  planForPriceId,
  priceIdForPlan,
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

  it("reconoce Agencia (inmobiliaria) como plan válido, con su historial de concesión manual", () => {
    const raw = JSON.stringify({
      allok: {
        billing: {
          plan: "inmobiliaria",
          status: "active",
          source: "manual_2026-09-29",
          grantedBy: "admin@allok.fun",
          grantedAt: "2026-09-29T10:00:00.000Z",
        },
      },
    });
    expect(billingFromMetadata(raw)).toMatchObject({
      plan: "inmobiliaria",
      status: "active",
      source: "manual_2026-09-29",
      grantedBy: "admin@allok.fun",
      grantedAt: "2026-09-29T10:00:00.000Z",
    });
  });

  it("solo reconoce los Price IDs configurados para Basic, Pro y Agencia", () => {
    vi.stubEnv("ALLOK_SAAS_STRIPE_BASIC_PRICE_ID", "price_basic_test");
    vi.stubEnv("ALLOK_SAAS_STRIPE_PRO_PRICE_ID", "price_pro_test");
    vi.stubEnv("ALLOK_SAAS_STRIPE_INMO_PRICE_ID", "price_inmo_test");
    expect(planForPriceId("price_basic_test")).toBe("basic");
    expect(planForPriceId("price_pro_test")).toBe("pro");
    expect(planForPriceId("price_inmo_test")).toBe("inmobiliaria");
    expect(planForPriceId("price_inventado")).toBeNull();
  });

  it("priceIdForPlan lee la variable de Agencia (ALLOK_SAAS_STRIPE_INMO_PRICE_ID)", () => {
    vi.stubEnv("ALLOK_SAAS_STRIPE_INMO_PRICE_ID", "price_inmo_test");
    expect(priceIdForPlan("inmobiliaria")).toBe("price_inmo_test");
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

  it("sólo Pro lleva prueba gratis, y son 7 días — Agencia cobra desde el día 1", () => {
    expect(trialDaysForPlan("pro")).toBe(7);
    expect(trialDaysForPlan("basic")).toBeUndefined();
    expect(trialDaysForPlan("inmobiliaria")).toBeUndefined();
  });

  it("la prueba es una sola vez por negocio", () => {
    expect(trialDaysForPlan("pro", true)).toBeUndefined();
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  billingFromMetadata,
  hadPriorSubscription,
  isCurrentOrFirstSubscriptionEvent,
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

  it("guarda hasta 10 entradas de historial manual, la más reciente primero", () => {
    const history = Array.from({ length: 3 }, (_, i) => ({
      at: `2026-09-0${i + 1}T00:00:00.000Z`,
      by: "admin@allok.fun",
      action: i % 2 === 0 ? "grant" : "revoke",
      plan: "pro",
      confirmOverrideStripe: false,
    }));
    const raw = JSON.stringify({ allok: { billing: { plan: "pro", status: "active", history } } });
    expect(billingFromMetadata(raw).history).toEqual(history);
  });

  it("una entrada de historial con forma inválida se descarta sin romper el resto", () => {
    const raw = JSON.stringify({
      allok: {
        billing: {
          history: [
            { at: "2026-09-01T00:00:00.000Z", by: "admin@allok.fun", action: "grant", plan: "pro", confirmOverrideStripe: false },
            { action: "grant" }, // sin at/by — inválida
            "no es un objeto",
          ],
        },
      },
    });
    expect(billingFromMetadata(raw).history).toHaveLength(1);
  });

  describe("hadPriorSubscription — quién no se lleva una segunda prueba gratis", () => {
    function billingWith(patch: Record<string, unknown>) {
      return billingFromMetadata(JSON.stringify({ allok: { billing: patch } }));
    }

    it("nunca tuvo suscripción ni concesión manual → false", () => {
      expect(hadPriorSubscription(billingWith({}))).toBe(false);
    });

    it("tiene una suscripción de Stripe → true", () => {
      expect(hadPriorSubscription(billingWith({ subscriptionId: "sub_1" }))).toBe(true);
    });

    it("nunca tuvo Stripe, pero sí una concesión manual (aunque ya la hayan quitado) → true", () => {
      expect(hadPriorSubscription(billingWith({ subscriptionId: null, grantedAt: "2026-09-01T00:00:00.000Z", status: "canceled" }))).toBe(true);
    });
  });

  describe("isCurrentOrFirstSubscriptionEvent — qué evento de suscripción se acepta", () => {
    function billingWith(patch: Record<string, unknown>) {
      return billingFromMetadata(JSON.stringify({ allok: { billing: patch } }));
    }

    it("acepta un evento de la suscripción vigente", () => {
      const current = billingWith({ subscriptionId: "sub_actual" });
      expect(isCurrentOrFirstSubscriptionEvent(current, "sub_actual")).toBe(true);
    });

    it("acepta la primera suscripción que ve la organización (nunca tuvo ninguna)", () => {
      const current = billingWith({ subscriptionId: null });
      expect(isCurrentOrFirstSubscriptionEvent(current, "sub_nueva")).toBe(true);
    });

    it("rechaza un evento de una suscripción distinta a la vigente", () => {
      const current = billingWith({ subscriptionId: "sub_actual" });
      expect(isCurrentOrFirstSubscriptionEvent(current, "sub_otra")).toBe(false);
    });

    it("rechaza un evento tardío de la suscripción que una concesión manual desenganchó", () => {
      const current = billingWith({ subscriptionId: null, detachedSubscriptionId: "sub_vieja" });
      expect(isCurrentOrFirstSubscriptionEvent(current, "sub_vieja")).toBe(false);
    });
  });
});

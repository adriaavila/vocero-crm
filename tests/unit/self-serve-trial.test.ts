import { afterEach, describe, expect, it } from "vitest";
import {
  automationAccessFromMetadata,
  hasPaidSaaSPlanFromMetadata,
  selfServeTrialExpired,
} from "@/server/agencia/entitlements";
import { hadPriorSubscription, billingFromMetadata, isSelfServeTrial } from "@/server/saas/billing";

const DAY = 24 * 60 * 60 * 1000;

function metadata(billing: Record<string, unknown>): string {
  return JSON.stringify({ allok: { billing } });
}

const trial = (endsInMs: number, extra: Record<string, unknown> = {}) => ({
  plan: "pro",
  status: "trialing",
  source: "self_serve_trial",
  subscriptionId: null,
  currentPeriodEnd: new Date(Date.now() + endsInMs).toISOString(),
  ...extra,
});

describe("prueba de autoservicio (7 días, sin Stripe)", () => {
  afterEach(() => {
    delete process.env.ALLOK_SAAS_MODE;
  });

  it("da automatización y Completo mientras está vigente", () => {
    const raw = metadata(trial(3 * DAY));
    expect(automationAccessFromMetadata(raw, true)).toEqual({ allowed: true, status: "trialing" });
    expect(hasPaidSaaSPlanFromMetadata(raw, "pro", true)).toBe(true);
  });

  it("vence sola por fecha: sin automatización ni Completo", () => {
    const raw = metadata(trial(-1000));
    expect(automationAccessFromMetadata(raw, true)).toEqual({ allowed: false, status: "inactive" });
    expect(hasPaidSaaSPlanFromMetadata(raw, "pro", true)).toBe(false);
  });

  it("una prueba sin fecha de fin cuenta como vencida (nunca infinita)", () => {
    expect(selfServeTrialExpired(trial(0, { currentPeriodEnd: null }))).toBe(true);
  });

  it("deja de aplicar en cuanto hay suscripción de Stripe", () => {
    const paid = trial(-DAY, { subscriptionId: "sub_1", status: "active" });
    expect(selfServeTrialExpired(paid)).toBe(false);
    expect(automationAccessFromMetadata(metadata(paid), true).allowed).toBe(true);
  });

  it("no regala una segunda prueba de Stripe a quien ya tuvo la de autoservicio", () => {
    const state = billingFromMetadata(metadata(trial(3 * DAY)));
    expect(isSelfServeTrial(state)).toBe(true);
    expect(hadPriorSubscription(state)).toBe(true);
  });
});

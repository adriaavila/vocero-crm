import { describe, expect, it } from "vitest";
import {
  derivePlanState,
  planActionLabel,
  planCanCheckout,
  planHeadline,
  TRIAL_AI_REPLIES,
  TRIAL_SOURCE,
} from "@/lib/plan-estado";
import { automationAccessFromMetadata } from "@/server/agencia/entitlements";
import {
  billingFromMetadata,
  checkoutBlockedReason,
  invoiceSubscriptionId,
  isCurrentOrFirstSubscriptionEvent,
  SELF_SERVE_TRIAL_AI_REPLIES,
  SELF_SERVE_TRIAL_SOURCE,
  subscriptionEndsAtPeriodEnd,
} from "@/server/saas/billing";
import { buildTrialEndedEmail, buildTrialEndingEmail } from "@/server/agencia/trial-correos";

const NOW = Date.parse("2026-10-03T12:00:00Z");
const DAY = 86_400_000;
const meta = (billing: Record<string, unknown>) => JSON.stringify({ allok: { billing } });
const state = (billing: Record<string, unknown>, replies: number | null = 0) =>
  derivePlanState(billingFromMetadata(meta(billing)), replies, NOW);
const trial = (endsInMs: number, extra: Record<string, unknown> = {}) => ({
  plan: "pro", status: "trialing", source: TRIAL_SOURCE, currentPeriodEnd: new Date(NOW + endsInMs).toISOString(), ...extra,
});

describe("derivePlanState", () => {
  it("prueba vigente: días y respuestas", () => {
    const s = state(trial(5 * DAY), 120);
    expect(s).toMatchObject({ kind: "trial", agentAllowed: true, daysLeft: 5, replies: { used: 120, cap: 300 } });
    expect(planHeadline(s)).toContain("te quedan 5 días");
    expect(planActionLabel(s)).toBe("Elegir plan");
  });
  it("termina pronto por días o por respuestas", () => {
    expect(state(trial(DAY * 1.5)).kind).toBe("trial_ending");
    expect(state(trial(5 * DAY), 240).kind).toBe("trial_ending");
    expect(state(trial(5 * DAY), 239).kind).toBe("trial");
  });
  it("tope de respuestas: pausa el agente aunque queden días", () => {
    const s = state(trial(5 * DAY), 300);
    expect(s).toMatchObject({ kind: "trial_cap", agentAllowed: false });
    expect(planHeadline(s)).toContain("en pausa");
  });
  it("prueba vencida y checkout a medias leen «terminó»", () => {
    expect(state(trial(-1000)).kind).toBe("trial_ended");
    expect(state({ plan: "pro", status: "incomplete", source: TRIAL_SOURCE, currentPeriodEnd: new Date(NOW - DAY).toISOString() }).kind).toBe("trial_ended");
  });
  it("cobro fallido, cancelado, por cancelarse, al día y nunca tuvo", () => {
    const sub = { source: TRIAL_SOURCE, subscriptionId: "sub_1", plan: "pro" };
    expect(state({ ...sub, status: "past_due" })).toMatchObject({ kind: "payment_failed", agentAllowed: false, hasSubscription: true });
    expect(state({ ...sub, status: "unpaid" }).kind).toBe("payment_failed");
    expect(state({ ...sub, status: "canceled" }).kind).toBe("canceled");
    expect(state({ ...sub, status: "active", cancelAtPeriodEnd: true, currentPeriodEnd: new Date(NOW + 3 * DAY).toISOString() })).toMatchObject({ kind: "cancelling", agentAllowed: true, daysLeft: 3 });
    expect(state({ ...sub, status: "active" }).kind).toBe("paid");
    expect(state({ ...sub, status: "trialing" }).kind).toBe("paid");
    expect(state({}).kind).toBe("none");
  });
  it("un cobro fallido se arregla en el portal, no con un checkout nuevo", () => {
    expect(planCanCheckout(state({ source: TRIAL_SOURCE, subscriptionId: "sub_1", status: "past_due" }))).toBe(false);
    expect(planActionLabel(state({ subscriptionId: "sub_1", status: "past_due" }))).toBe("Actualizar pago");
    expect(planCanCheckout(state({ status: "canceled", subscriptionId: "sub_1" }))).toBe(true);
    expect(planCanCheckout(state({ status: "active", subscriptionId: "sub_1" }))).toBe(false);
  });
  it("coincide con lo que de verdad frena al agente (canAutomate + tope)", () => {
    const cases: Record<string, unknown>[] = [
      trial(5 * DAY), trial(-1000), { status: "active", plan: "pro", subscriptionId: "s" }, { status: "past_due", subscriptionId: "s" },
      { status: "canceled", subscriptionId: "s" }, { status: "incomplete" }, { status: "trialing", plan: "pro", subscriptionId: "s" }, {},
    ];
    for (const c of cases) {
      expect(state(c).agentAllowed, JSON.stringify(c)).toBe(automationAccessFromMetadata(meta(c), true).allowed);
    }
  });
  it("las constantes espejo coinciden con las del servidor", () => {
    expect(TRIAL_SOURCE).toBe(SELF_SERVE_TRIAL_SOURCE);
    expect(TRIAL_AI_REPLIES).toBe(SELF_SERVE_TRIAL_AI_REPLIES);
  });
});

describe("cobro: helpers del webhook y del checkout", () => {
  it("cancelar desde el portal pone cancel_at, no cancel_at_period_end", () => {
    expect(subscriptionEndsAtPeriodEnd({ cancel_at_period_end: false, cancel_at: Math.floor((NOW + DAY) / 1000) }, NOW)).toBe(true);
    expect(subscriptionEndsAtPeriodEnd({ cancel_at_period_end: true, cancel_at: null }, NOW)).toBe(true);
    expect(subscriptionEndsAtPeriodEnd({ cancel_at_period_end: false, cancel_at: null }, NOW)).toBe(false);
    expect(subscriptionEndsAtPeriodEnd({ cancel_at: Math.floor((NOW - DAY) / 1000) }, NOW)).toBe(false);
  });
  it("lee la suscripción de la factura en las dos formas de la API", () => {
    expect(invoiceSubscriptionId({ subscription: "sub_old" })).toBe("sub_old");
    expect(invoiceSubscriptionId({ parent: { subscription_details: { subscription: "sub_new" } } })).toBe("sub_new");
    expect(invoiceSubscriptionId({ parent: { subscription_details: { subscription: { id: "sub_obj" } } } })).toBe("sub_obj");
    expect(invoiceSubscriptionId({})).toBeNull();
  });
  it("checkout: con cobro fallido manda al portal; cancelado o vencido, abre uno nuevo", () => {
    expect(checkoutBlockedReason({ source: null, subscriptionId: "s", status: "past_due" })).toBe("payment_failed");
    expect(checkoutBlockedReason({ source: null, subscriptionId: "s", status: "active" })).toBe("active");
    expect(checkoutBlockedReason({ source: null, subscriptionId: "s", status: "canceled" })).toBeNull();
    expect(checkoutBlockedReason({ source: SELF_SERVE_TRIAL_SOURCE, subscriptionId: null, status: "trialing" })).toBeNull();
  });
  it("quien se da de baja y vuelve: la suscripción NUEVA reemplaza a la muerta; una vieja tardía no", () => {
    const cancelled = billingFromMetadata(meta({ status: "canceled", subscriptionId: "sub_a" }));
    expect(isCurrentOrFirstSubscriptionEvent(cancelled, "sub_b", "customer.subscription.created")).toBe(true);
    expect(isCurrentOrFirstSubscriptionEvent(cancelled, "sub_b", "customer.subscription.updated")).toBe(false);
    const live = billingFromMetadata(meta({ status: "active", subscriptionId: "sub_b" }));
    expect(isCurrentOrFirstSubscriptionEvent(live, "sub_a", "customer.subscription.created")).toBe(false);
  });
});

describe("correos de la prueba", () => {
  const base = { to: "a@b.test", billingUrl: "http://x.localhost/settings/billing", brandName: "allok", timeZone: "America/Caracas" };
  it("«termina en 2 días» y «terminó» llevan el enlace, sin rayas largas", () => {
    const ending = buildTrialEndingEmail({ ...base, endsAt: new Date(NOW + 2 * DAY).toISOString(), now: NOW });
    const ended = buildTrialEndedEmail({ ...base, endsAt: new Date(NOW - DAY).toISOString(), now: NOW });
    expect(ending.subject).toBe("Tu prueba de allok termina en 2 días");
    expect(ended.subject).toContain("terminó");
    for (const mail of [ending, ended]) {
      expect(mail.text).toContain(base.billingUrl);
      expect(mail.html).toContain(base.billingUrl);
      expect(mail.text + mail.html + mail.subject).not.toMatch(/—/);
    }
    expect(buildTrialEndingEmail({ ...base, endsAt: new Date(NOW + 5 * 3600e3).toISOString(), now: NOW }).subject).toContain("mañana");
  });
});

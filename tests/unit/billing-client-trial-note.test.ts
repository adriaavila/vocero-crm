import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { BASIC_DURING_TRIAL_NOTE, BillingClient } from "@/components/settings/billing-client";
import { derivePlanState } from "@/lib/plan-estado";
import { billingFromMetadata } from "@/server/saas/billing";

const NOW = Date.parse("2026-10-10T12:00:00Z");

function render(billingRaw: Record<string, unknown>) {
  const billing = billingFromMetadata(JSON.stringify({ allok: { billing: billingRaw } }));
  return renderToStaticMarkup(
    createElement(BillingClient, {
      billing,
      plan: derivePlanState(billing, null, NOW),
      soldPlans: ["basic", "pro"],
      brandName: "allok",
    }),
  );
}

describe("BillingClient plan grid", () => {
  it("tells the owner on the Esencial card, during the trial, that the agent answers only outside their hours", () => {
    const html = render({
      plan: "pro",
      status: "trialing",
      source: "self_serve_trial",
      currentPeriodEnd: new Date(NOW + 5 * 24 * 3600 * 1000).toISOString(),
    });
    expect(BASIC_DURING_TRIAL_NOTE).toBe("Desde hoy tu agente contesta solo fuera de tu horario.");
    expect(html.split(BASIC_DURING_TRIAL_NOTE)).toHaveLength(2); // una sola vez: la tarjeta de Esencial
  });

  it("does not show it once the trial is over (no plan was ever changed from Completo)", () => {
    const html = render({
      plan: "pro",
      status: "trialing",
      source: "self_serve_trial",
      currentPeriodEnd: new Date(NOW - 24 * 3600 * 1000).toISOString(),
    });
    expect(html).not.toContain(BASIC_DURING_TRIAL_NOTE);
  });
});

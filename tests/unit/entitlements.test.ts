import { describe, expect, it } from "vitest";
import { automationAccessFromMetadata, hasPaidSaaSPlanFromMetadata } from "../../src/server/agencia/entitlements";

describe("Allok automation entitlements", () => {
  it("preserves legacy instances", () => {
    expect(automationAccessFromMetadata(null, false).allowed).toBe(true);
  });

  it("allows only paid SaaS states", () => {
    expect(
      automationAccessFromMetadata(
        JSON.stringify({ allok: { billing: { status: "active" } } }),
        true,
      ).allowed,
    ).toBe(true);
    expect(
      automationAccessFromMetadata(
        JSON.stringify({ allok: { billing: { status: "past_due" } } }),
        true,
      ).allowed,
    ).toBe(false);
  });

  it("fails closed when billing metadata is missing or invalid", () => {
    expect(automationAccessFromMetadata(null, true).allowed).toBe(false);
    expect(automationAccessFromMetadata("not-json", true).status).toBe("inactive");
  });

  it("pauses Pro-only access on failed payment and restores it after recovery", () => {
    const paid = JSON.stringify({ allok: { billing: { plan: "pro", status: "active" } } });
    const failed = JSON.stringify({ allok: { billing: { plan: "pro", status: "past_due" } } });
    expect(hasPaidSaaSPlanFromMetadata(paid, "pro", true)).toBe(true);
    expect(hasPaidSaaSPlanFromMetadata(failed, "pro", true)).toBe(false);
  });
});

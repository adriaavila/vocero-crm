import { describe, expect, it } from "vitest";
import { checkoutBodySchema } from "../../src/server/saas/checkout";

describe("POST /api/saas/billing/checkout — validación del body", () => {
  it("acepta los tres planes, incluida Agencia (inmobiliaria)", () => {
    expect(checkoutBodySchema.safeParse({ plan: "basic" }).success).toBe(true);
    expect(checkoutBodySchema.safeParse({ plan: "pro" }).success).toBe(true);
    expect(checkoutBodySchema.safeParse({ plan: "inmobiliaria" }).success).toBe(true);
  });

  it("rechaza un plan que no existe", () => {
    expect(checkoutBodySchema.safeParse({ plan: "enterprise" }).success).toBe(false);
    expect(checkoutBodySchema.safeParse({}).success).toBe(false);
  });
});

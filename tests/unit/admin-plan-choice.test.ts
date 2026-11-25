import { describe, expect, it } from "vitest";
import { initialPlanChoice } from "@/components/admin/tenants-table";

/**
 * El selector de plan del panel admin arrancaba siempre en Esencial: tocar
 * «Activar plan» sin mirarlo le bajó a SAMER (Rei) el plan Agencia del cupón
 * y le escondió Ventas y Propiedades. Ahora arranca en lo que el negocio ya
 * tiene.
 */
describe("initialPlanChoice", () => {
  it("arranca en el plan que el negocio ya tiene, aunque el despliegue venda otro", () => {
    expect(initialPlanChoice("inmobiliaria", "basic")).toBe("inmobiliaria");
    expect(initialPlanChoice("pro", "inmobiliaria")).toBe("pro");
  });

  it("sin plan, el primero que vende el despliegue (Agencia en Rei)", () => {
    expect(initialPlanChoice(null, "inmobiliaria")).toBe("inmobiliaria");
  });

  it("sin plan ni lista, Esencial como antes", () => {
    expect(initialPlanChoice(null, undefined)).toBe("basic");
  });
});

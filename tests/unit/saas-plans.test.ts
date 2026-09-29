import { describe, expect, it } from "vitest";
import { isSaaSPlan, PLAN_CATALOG, PLAN_ORDER, planMeetsTier, soldSaaSPlans } from "../../src/lib/saas-plans";

describe("Catálogo de planes SaaS", () => {
  it("tiene una entrada de catálogo por cada plan del orden de nivel", () => {
    for (const id of PLAN_ORDER) {
      expect(PLAN_CATALOG[id]).toMatchObject({ id });
      expect(PLAN_CATALOG[id].priceUsd).toBeGreaterThan(0);
      expect(PLAN_CATALOG[id].features.length).toBeGreaterThan(0);
    }
  });

  it("Agencia (inmobiliaria) es el plan más caro, a USD 299/mes", () => {
    expect(PLAN_CATALOG.inmobiliaria.name).toBe("Agencia");
    expect(PLAN_CATALOG.inmobiliaria.priceUsd).toBe(299);
  });

  it("isSaaSPlan solo acepta los tres literales conocidos", () => {
    expect(isSaaSPlan("basic")).toBe(true);
    expect(isSaaSPlan("pro")).toBe(true);
    expect(isSaaSPlan("inmobiliaria")).toBe(true);
    expect(isSaaSPlan("enterprise")).toBe(false);
    expect(isSaaSPlan(null)).toBe(false);
    expect(isSaaSPlan(undefined)).toBe(false);
  });

  describe("planMeetsTier — basic < pro < inmobiliaria, cada uno incluye al anterior", () => {
    it("un plan siempre alcanza su propio umbral", () => {
      expect(planMeetsTier("basic", "basic")).toBe(true);
      expect(planMeetsTier("pro", "pro")).toBe(true);
      expect(planMeetsTier("inmobiliaria", "inmobiliaria")).toBe(true);
    });

    it("un plan superior alcanza el umbral de uno inferior", () => {
      expect(planMeetsTier("pro", "basic")).toBe(true);
      expect(planMeetsTier("inmobiliaria", "basic")).toBe(true);
      expect(planMeetsTier("inmobiliaria", "pro")).toBe(true);
    });

    it("un plan inferior NO alcanza el umbral de uno superior", () => {
      expect(planMeetsTier("basic", "pro")).toBe(false);
      expect(planMeetsTier("basic", "inmobiliaria")).toBe(false);
      expect(planMeetsTier("pro", "inmobiliaria")).toBe(false);
    });

    it("sin plan (null/undefined) nunca alcanza ningún umbral", () => {
      expect(planMeetsTier(null, "basic")).toBe(false);
      expect(planMeetsTier(undefined, "basic")).toBe(false);
    });
  });

  describe("soldSaaSPlans — SAAS_PLANS", () => {
    it("sin configurar, vende basic y pro (el comportamiento de siempre)", () => {
      expect(soldSaaSPlans(undefined)).toEqual(["basic", "pro"]);
      expect(soldSaaSPlans(null)).toEqual(["basic", "pro"]);
      expect(soldSaaSPlans("")).toEqual(["basic", "pro"]);
    });

    it("respeta la lista configurada, en el orden de nivel (no el de la variable)", () => {
      expect(soldSaaSPlans("pro,basic")).toEqual(["basic", "pro"]);
      expect(soldSaaSPlans("basic,pro,inmobiliaria")).toEqual(["basic", "pro", "inmobiliaria"]);
      expect(soldSaaSPlans("inmobiliaria")).toEqual(["inmobiliaria"]);
    });

    it("ignora espacios y valores desconocidos, sin romper", () => {
      expect(soldSaaSPlans(" basic , pro , enterprise ")).toEqual(["basic", "pro"]);
    });

    it("una lista solo de valores desconocidos cae al default", () => {
      expect(soldSaaSPlans("enterprise,foo")).toEqual(["basic", "pro"]);
    });
  });
});

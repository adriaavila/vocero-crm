import { describe, expect, it, vi } from "vitest";
import {
  billingStatusLabel,
  formatManualSource,
  isSaaSPlan,
  PLAN_CATALOG,
  PLAN_ORDER,
  planMeetsTier,
  soldSaaSPlans,
} from "../../src/lib/saas-plans";

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

  it("cupo de usuarios: Esencial/Completo en 3 (como siempre), Agencia en 10", () => {
    expect(PLAN_CATALOG.basic.seats).toBe(3);
    expect(PLAN_CATALOG.pro.seats).toBe(3);
    expect(PLAN_CATALOG.inmobiliaria.seats).toBe(10);
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

    it("bajo BRAND=rei, sin configurar vende solo Agencia (inmobiliaria)", () => {
      vi.stubEnv("BRAND", "rei");
      try {
        expect(soldSaaSPlans(undefined)).toEqual(["inmobiliaria"]);
        expect(soldSaaSPlans("enterprise")).toEqual(["inmobiliaria"]);
        expect(soldSaaSPlans("basic,pro")).toEqual(["basic", "pro"]);
      } finally {
        vi.unstubAllEnvs();
      }
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

    it("no distingue mayúsculas", () => {
      expect(soldSaaSPlans("Basic,PRO,Inmobiliaria")).toEqual(["basic", "pro", "inmobiliaria"]);
    });

    it("avisa por consola de los valores desconocidos que descarta", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      soldSaaSPlans("basic,typo_pro");
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("typo_pro"));
      warn.mockRestore();
    });
  });

  describe("billingStatusLabel", () => {
    it("traduce cada estado conocido al español", () => {
      expect(billingStatusLabel("active")).toBe("activo");
      expect(billingStatusLabel("trialing")).toBe("en prueba");
      expect(billingStatusLabel("past_due")).toBe("pago pendiente");
      expect(billingStatusLabel("unpaid")).toBe("impago");
      expect(billingStatusLabel("canceled")).toBe("cancelado");
      expect(billingStatusLabel("incomplete")).toBe("incompleto");
      expect(billingStatusLabel("inactive")).toBe("inactivo");
    });

    it("un estado desconocido se muestra tal cual", () => {
      expect(billingStatusLabel("algo_raro")).toBe("algo_raro");
    });
  });

  describe("formatManualSource", () => {
    it("formatea manual_<fecha> en español", () => {
      // El ICU de "short month" varía por entorno ("sep" vs "sept"); se
      // valida la forma, no el string exacto del mes.
      expect(formatManualSource("manual_2026-09-29")).toMatch(/^Manual · 29 sept?\.? 2026$/);
    });

    it("sin fuente, null", () => {
      expect(formatManualSource(null)).toBeNull();
      expect(formatManualSource(undefined)).toBeNull();
    });

    it("un formato que no matchea se muestra tal cual", () => {
      expect(formatManualSource("stripe_checkout")).toBe("stripe_checkout");
    });
  });
});

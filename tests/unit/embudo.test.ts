import { describe, expect, it } from "vitest";
import { embudoPorFuente, estaPagando, semanaIso, type EmbudoTenant } from "@/server/agencia/embudo";
import { PLAN_CATALOG } from "@/lib/saas-plans";

function tenant(over: Partial<Omit<EmbudoTenant, "billing">> & { billing?: Partial<EmbudoTenant["billing"]> } = {}): EmbudoTenant {
  const { billing, ...rest } = over;
  return {
    createdAt: "2026-10-05T12:00:00.000Z",
    whatsapp: "not_connected",
    agentEnabled: false,
    origen: null,
    ...rest,
    billing: { plan: "pro", status: "trialing", source: "self_serve_trial", subscriptionId: null, ...billing },
  };
}

describe("estaPagando", () => {
  it("solo una suscripción de Stripe activa o con cobro por reintentar", () => {
    expect(estaPagando({ plan: "pro", status: "active", source: null, subscriptionId: "sub_1" })).toBe(true);
    expect(estaPagando({ plan: "pro", status: "past_due", source: null, subscriptionId: "sub_1" })).toBe(true);
    expect(estaPagando({ plan: "pro", status: "trialing", source: null, subscriptionId: "sub_1" })).toBe(false);
    expect(estaPagando({ plan: "pro", status: "canceled", source: null, subscriptionId: "sub_1" })).toBe(false);
    // Prueba de autoservicio (sin suscripción) y concesión manual: no es Stripe.
    expect(estaPagando({ plan: "pro", status: "trialing", source: "self_serve_trial", subscriptionId: null })).toBe(false);
    expect(estaPagando({ plan: "pro", status: "active", source: "manual_2026-10-01", subscriptionId: null })).toBe(false);
  });
});

describe("semanaIso", () => {
  it("lunes a domingo, con el año del jueves", () => {
    expect(semanaIso(new Date("2026-10-05T00:00:00Z"))).toBe("2026-W41");
    expect(semanaIso(new Date("2026-10-04T23:59:00Z"))).toBe("2026-W40");
    expect(semanaIso(new Date("2027-01-01T10:00:00Z"))).toBe("2026-W53");
    expect(semanaIso(new Date("2024-12-30T10:00:00Z"))).toBe("2025-W01");
  });
});

describe("embudoPorFuente", () => {
  const tenants: EmbudoTenant[] = [
    tenant({ origen: { utm_source: "Facebook", at: "x" }, whatsapp: "connected", agentEnabled: true, billing: { plan: "pro", status: "active", subscriptionId: "sub_a" } }),
    tenant({ origen: { utm_source: "facebook", at: "x" }, whatsapp: "connected", billing: { plan: "basic", status: "past_due", subscriptionId: "sub_b" } }),
    tenant({ origen: { utm_source: "facebook", at: "x" } }),
    tenant({ origen: { ref: "ana", at: "x" }, whatsapp: "reconnect_required", billing: { plan: "pro", status: "trialing", subscriptionId: "sub_c" } }),
    tenant({ createdAt: "2026-09-20T12:00:00.000Z" }),
  ];

  it("cuenta altas, WhatsApp, agente, pagando y MRR por canal", () => {
    const { porFuente, total } = embudoPorFuente(tenants);
    expect(porFuente).toEqual([
      { fuente: "facebook", altas: 3, whatsappConectado: 2, agenteActivo: 1, pagando: 2, mrrUsd: PLAN_CATALOG.pro.priceUsd + PLAN_CATALOG.basic.priceUsd },
      { fuente: "directo", altas: 1, whatsappConectado: 0, agenteActivo: 0, pagando: 0, mrrUsd: 0 },
      { fuente: "ref:ana", altas: 1, whatsappConectado: 0, agenteActivo: 0, pagando: 0, mrrUsd: 0 },
    ]);
    expect(total).toEqual({ altas: 5, whatsappConectado: 2, agenteActivo: 1, pagando: 2, mrrUsd: 148 });
  });

  it("agrupa por semana ISO, la más nueva primero", () => {
    const { porSemana } = embudoPorFuente(tenants);
    expect(porSemana.map((s) => [s.semana, s.altas, s.pagando])).toEqual([
      ["2026-W41", 4, 2],
      ["2026-W38", 1, 0],
    ]);
  });

  it("`desde` deja fuera las altas anteriores", () => {
    const { total, porFuente } = embudoPorFuente(tenants, { desde: new Date("2026-10-01T00:00:00Z") });
    expect(total.altas).toBe(4);
    expect(porFuente.find((f) => f.fuente === "directo")).toBeUndefined();
  });

  it("sin negocios, todo en cero", () => {
    expect(embudoPorFuente([])).toEqual({
      total: { altas: 0, whatsappConectado: 0, agenteActivo: 0, pagando: 0, mrrUsd: 0 },
      porFuente: [],
      porSemana: [],
    });
  });
});

import { describe, expect, it } from "vitest";
import { evaluateReadiness, saasActivationBlockers } from "@/server/readiness";

const changedAt = new Date("2026-08-10T10:00:00Z");
const runAt = new Date("2026-08-10T11:00:00Z");
const liveAt = new Date("2026-08-10T12:00:00Z");

function input(overrides: Record<string, unknown> = {}) {
  return {
    profile: {
      id: "profile",
      organizationId: "org",
      enabled: false,
      name: "Vocero",
      tone: "Cercano",
      greeting: "Hola",
      instructions: "Ayuda con precisión",
      escalationRules: "Escala si no sabes",
      activationEnabled: false,
      activationMessages: [],
      allowlistEnabled: false,
      allowedWaIds: [],
      aiProvider: "openai" as const,
      lastLiveTestAt: liveAt,
      lastLiveTestPassed: true,
      lastLiveTestElapsedMs: 800,
      createdAt: changedAt,
      updatedAt: changedAt,
    },
    whatsappConnected: true,
    aiConfigured: true,
    liveTestAvailable: true,
    knowledgeCount: 1,
    knowledgeUpdatedAt: changedAt,
    latestRun: {
      id: "run",
      organizationId: "org",
      status: "done" as const,
      score: 90,
      error: null,
      startedAt: runAt,
      finishedAt: runAt,
    },
    redCount: 0,
    brandingCustomized: false,
    teamMemberCount: 1,
    // Capa de agencia: sin agenda en esta instancia, el paso no existe.
    agendaStep: null,
    ...overrides,
  } as Parameters<typeof evaluateReadiness>[0];
}

describe("readiness", () => {
  it("is ready only after a current passing simulation and live test", () => {
    expect(evaluateReadiness(input()).overall).toBe("ready");
  });

  it("un token revocado no se lee como un número sin conectar", () => {
    const muerto = evaluateReadiness(
      input({ whatsappConnected: false, whatsappStatus: "reconnect_required" }),
    ).steps.find((step) => step.id === "whatsapp")!;
    expect(muerto.status).toBe("pending");
    expect(muerto.detail).toMatch(/venció/);
    expect(muerto.detail).not.toMatch(/token/i);

    const nunca = evaluateReadiness(
      input({ whatsappConnected: false, whatsappStatus: null }),
    ).steps.find((step) => step.id === "whatsapp")!;
    expect(nunca.detail).toMatch(/Conecta el número/);
  });

  it.each([
    ["sin ninguna prueba", { latestRun: null }, "simulation", "pending"],
    ["simulación vieja", { knowledgeUpdatedAt: liveAt }, "simulation", "stale"],
    ["prueba real vieja", { profile: { ...input().profile, lastLiveTestAt: changedAt } }, "live_test", "stale"],
  ])("detects %s", (_label, overrides, stepId, status) => {
    const result = evaluateReadiness(input(overrides));
    expect(result.overall).toBe("needs_attention");
    expect(result.steps.find((step) => step.id === stepId)?.status).toBe(status);
  });

  it("el dueño decide: una prueba terminada después del último cambio cuenta, sea cual sea el puntaje", () => {
    const flojo = evaluateReadiness(input({
      latestRun: { ...input().latestRun!, score: 50 },
      redCount: 1,
      saasMode: true,
      businessHoursConfigured: true,
    }));
    const step = flojo.steps.find((s) => s.id === "simulation")!;
    expect(step.status).toBe("complete");
    expect(step.detail).toMatch(/50\/100/);
    expect(step.detail).not.toMatch(/80/);
    expect(flojo.latestLab).toMatchObject({ score: 50, redCount: 1 });
    expect(saasActivationBlockers(flojo)).toEqual([]);
  });

  it("instancia dedicada: la regla de siempre, 80 y ningún caso rojo", () => {
    const run = { ...input().latestRun!, score: 50 };
    const dedicada = evaluateReadiness(input({ latestRun: run, saasMode: false }));
    expect(dedicada.steps.find((s) => s.id === "simulation")?.status).toBe("pending");
    expect(evaluateReadiness(input({ redCount: 1, saasMode: false })).steps.find((s) => s.id === "simulation")?.status).toBe("pending");
    expect(evaluateReadiness(input({ saasMode: false })).steps.find((s) => s.id === "simulation")?.status).toBe("complete");
    expect(evaluateReadiness(input({ latestRun: run, saasMode: true })).steps.find((s) => s.id === "simulation")?.status).toBe("complete");
  });

  it("una corrida que empezó antes del último cambio es vieja aunque terminara después", () => {
    const vieja = evaluateReadiness(input({
      latestRun: { ...input().latestRun!, score: 100, startedAt: changedAt, finishedAt: liveAt },
      knowledgeUpdatedAt: runAt,
      saasMode: true,
    }));
    expect(vieja.steps.find((s) => s.id === "simulation")?.status).toBe("stale");
  });

  it("sin prueba, el paso pide probar una vez y no menciona un puntaje mínimo", () => {
    const sin = evaluateReadiness(input({ latestRun: null })).steps.find((s) => s.id === "simulation")!;
    expect(sin.status).toBe("pending");
    expect(sin.detail).not.toMatch(/\d/);
  });

  it("exposes the critical SaaS steps that must be complete before activation", () => {
    const readiness = evaluateReadiness(input({
      saasMode: true,
      businessHoursConfigured: false,
      knowledgeCount: 0,
      profile: { ...input().profile, tone: null },
      latestRun: null,
    }));
    expect(saasActivationBlockers(readiness).map((step) => step.id)).toEqual([
      "business_hours",
      "agent_profile",
      "knowledge",
      "simulation",
    ]);
  });

  it("does not block SaaS readiness when the optional live test is unavailable", () => {
    expect(evaluateReadiness(input({
      saasMode: true,
      businessHoursConfigured: true,
      liveTestAvailable: false,
    })).overall).toBe("ready");
  });
});

/**
 * Capa de agencia: el paso de la agenda.
 *
 * Se inyecta desde fuera (resolverlo aquí requeriría base de datos y esta
 * función es pura). Lo que se comprueba es que se COLOQUE antes de las
 * pruebas: probar un agente que no tiene un solo hueco que ofrecer no prueba
 * nada, y verlo en verde después de "Prueba tu agente" invita a saltárselo.
 */
describe("puesta en marcha: la agenda", () => {
  const paso = {
    id: "agenda" as const,
    status: "pending" as const,
    label: "Configura la agenda",
    detail: "El horario semanal está vacío: la agenda no ofrece nada.",
    href: "/settings/calendar",
  };

  it("no aparece en una instancia sin agenda", () => {
    const ids = evaluateReadiness(input()).steps.map((s) => s.id);
    expect(ids).not.toContain("agenda");
  });

  it("aparece antes de las pruebas cuando la instancia agenda", () => {
    const ids = evaluateReadiness(input({ agendaStep: paso })).steps.map((s) => s.id);
    expect(ids.indexOf("agenda")).toBeGreaterThanOrEqual(0);
    expect(ids.indexOf("agenda")).toBeLessThan(ids.indexOf("simulation"));
  });

  it("una agenda sin configurar deja la instancia en 'needs_attention'", () => {
    expect(evaluateReadiness(input({ agendaStep: paso })).overall).toBe(
      "needs_attention"
    );
  });
});

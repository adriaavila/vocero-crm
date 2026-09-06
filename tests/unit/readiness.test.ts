import { describe, expect, it } from "vitest";
import { evaluateReadiness } from "@/server/readiness";

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

  it.each([
    ["score bajo", { latestRun: { ...input().latestRun!, score: 79 } }, "simulation", "pending"],
    ["casos rojos", { redCount: 1 }, "simulation", "pending"],
    ["simulación vieja", { knowledgeUpdatedAt: liveAt }, "simulation", "stale"],
    ["prueba real vieja", { profile: { ...input().profile, lastLiveTestAt: changedAt } }, "live_test", "stale"],
  ])("detects %s", (_label, overrides, stepId, status) => {
    const result = evaluateReadiness(input(overrides));
    expect(result.overall).toBe("needs_attention");
    expect(result.steps.find((step) => step.id === stepId)?.status).toBe(status);
  });

  it("never accepts a live test when the current simulation failed", () => {
    const result = evaluateReadiness(input({ redCount: 1 }));
    expect(result.steps.find((step) => step.id === "live_test")?.status).toBe("stale");
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

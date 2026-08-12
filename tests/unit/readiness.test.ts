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

import { describe, expect, it } from "vitest";
import { evaluateReadiness, type ReadinessResponse } from "@/server/readiness";
import { deriveSetupProgress } from "@/server/agencia/setup-progress";

const changedAt = new Date("2026-08-10T10:00:00Z");
const runAt = new Date("2026-08-10T11:00:00Z");

function readiness(overrides: Record<string, unknown> = {}): ReadinessResponse {
  return evaluateReadiness({
    profile: {
      enabled: false,
      name: "Asistente",
      tone: "Cercano",
      greeting: "Hola",
      instructions: "Ayuda con precisión",
      escalationRules: "Escala si no sabes",
      lastLiveTestAt: null,
      lastLiveTestPassed: null,
      updatedAt: changedAt,
    },
    whatsappConnected: true,
    aiConfigured: true,
    liveTestAvailable: false,
    knowledgeCount: 2,
    knowledgeUpdatedAt: changedAt,
    latestRun: { id: "run", organizationId: "org", status: "done", score: 90, error: null, startedAt: runAt, finishedAt: runAt },
    redCount: 0,
    brandingCustomized: false,
    teamMemberCount: 1,
    businessHoursConfigured: true,
    saasMode: true,
    agendaStep: null,
    ...overrides,
  } as Parameters<typeof evaluateReadiness>[0]);
}

const doneKeys = (progress: ReturnType<typeof deriveSetupProgress>) =>
  progress.steps.filter((step) => step.done).map((step) => step.key);

describe("deriveSetupProgress", () => {
  it("son cuatro pasos, siempre en el mismo orden y con la cuenta fuera", () => {
    const progress = deriveSetupProgress(readiness());
    expect(progress.steps.map((step) => step.label)).toEqual([
      "Conectar WhatsApp",
      "Tu negocio",
      "Probar",
      "Activar",
    ]);
  });

  it("cuenta nueva: nada hecho, el paso actual es conectar WhatsApp", () => {
    const progress = deriveSetupProgress(
      readiness({ whatsappConnected: false, knowledgeCount: 0, businessHoursConfigured: false, latestRun: null }),
    );
    expect(doneKeys(progress)).toEqual([]);
    expect(progress.current).toBe("whatsapp");
    expect(progress.active).toBe(true);
  });

  it("WhatsApp conectado pero sin información del negocio: sigue «Tu negocio»", () => {
    const progress = deriveSetupProgress(readiness({ knowledgeCount: 0, latestRun: null }));
    expect(doneKeys(progress)).toEqual(["whatsapp"]);
    expect(progress.current).toBe("negocio");
  });

  it("sin horario de respuesta, «Tu negocio» no está listo (SaaS)", () => {
    const progress = deriveSetupProgress(readiness({ businessHoursConfigured: false }));
    expect(progress.steps.find((step) => step.key === "negocio")?.done).toBe(false);
  });

  it("fuera del SaaS no hay paso de horario y no cuenta", () => {
    const progress = deriveSetupProgress(readiness({ saasMode: false, businessHoursConfigured: false }));
    expect(progress.steps.find((step) => step.key === "negocio")?.done).toBe(true);
  });

  it("negocio listo y sin prueba: toca «Probar»", () => {
    const progress = deriveSetupProgress(readiness({ latestRun: null }));
    expect(doneKeys(progress)).toEqual(["whatsapp", "negocio"]);
    expect(progress.current).toBe("probar");
  });

  it("cambiar la información después de probar deja «Probar» pendiente otra vez", () => {
    const progress = deriveSetupProgress(readiness({ knowledgeUpdatedAt: new Date("2026-08-10T12:00:00Z") }));
    expect(progress.steps.find((step) => step.key === "probar")?.done).toBe(false);
    expect(progress.current).toBe("probar");
  });

  it("una prueba que no pasa (score bajo o casos rojos) no cuenta", () => {
    expect(deriveSetupProgress(readiness({ redCount: 1 })).current).toBe("probar");
  });

  it("todo listo menos encender: el paso actual es «Activar»", () => {
    const progress = deriveSetupProgress(readiness());
    expect(doneKeys(progress)).toEqual(["whatsapp", "negocio", "probar"]);
    expect(progress.current).toBe("activar");
    expect(progress.active).toBe(true);
  });

  it("agente activo: los cuatro listos y la puesta en marcha deja de estar abierta", () => {
    const progress = deriveSetupProgress(
      readiness({ profile: onProfile() }),
    );
    expect(doneKeys(progress)).toEqual(["whatsapp", "negocio", "probar", "activar"]);
    expect(progress.current).toBeNull();
    expect(progress.active).toBe(false);
  });

  it("pausar solo reabre «Activar»: la prueba y lo demás siguen vigentes", () => {
    // Misma preparación con el agente encendido y apagado: lo único que cambia es «Activar».
    const on = deriveSetupProgress(readiness({ profile: { ...onProfile(), enabled: true } }));
    const off = deriveSetupProgress(readiness({ profile: { ...onProfile(), enabled: false } }));
    expect(doneKeys(on)).toEqual(["whatsapp", "negocio", "probar", "activar"]);
    expect(doneKeys(off)).toEqual(["whatsapp", "negocio", "probar"]);
  });

  it("un agente activo con la conexión vencida pide reconectar sin reabrir el asistente de alta", () => {
    const progress = deriveSetupProgress(
      readiness({ profile: { ...onProfile(), enabled: true }, whatsappConnected: false, whatsappStatus: "reconnect_required" }),
    );
    expect(progress.current).toBe("whatsapp");
    expect(progress.active).toBe(false);
  });
});

function onProfile() {
  return {
    enabled: true,
    name: "Asistente",
    tone: "Cercano",
    greeting: "Hola",
    instructions: "Ayuda con precisión",
    escalationRules: "Escala si no sabes",
    lastLiveTestAt: null,
    lastLiveTestPassed: null,
    updatedAt: changedAt,
  };
}

import { beforeEach, describe, expect, it, vi } from "vitest";
import { evaluateReadiness, type ReadinessResponse } from "@/server/readiness";

/**
 * La lista de bloqueos de «Activar» es la misma que aplica el servidor al
 * encender: mismo orden, mismos códigos y mensajes, y cada uno con su
 * versión en palabras de dueño.
 */

const m = vi.hoisted(() => ({
  canAutomate: vi.fn(),
  hasSaaSPlan: vi.fn(),
  aiAvailable: vi.fn(),
  credentials: vi.fn(),
  hours: vi.fn(),
  readiness: vi.fn(),
}));
let saasMode = true;
vi.mock("@/lib/tenant-host", () => ({ isAllokSaaSMode: () => saasMode }));
vi.mock("@/lib/db", () => ({ getDb: () => ({}), schema: {} }));
vi.mock("@/lib/db/tenant", () => ({ scoped: () => ({}) }));
vi.mock("@/server/agencia/entitlements", () => ({ canAutomate: m.canAutomate, hasSaaSPlan: m.hasSaaSPlan }));
vi.mock("@/server/ai/credentials", () => ({ isAgentAvailableForOrganization: m.aiAvailable }));
vi.mock("@/server/whatsapp/credentials", () => ({ getCredentialsByOrg: m.credentials }));
vi.mock("@/server/business-hours", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/business-hours")>()),
  getBusinessHours: m.hours,
}));
vi.mock("@/server/readiness", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/readiness")>()),
  getReadiness: m.readiness,
}));

const t0 = new Date("2026-08-10T10:00:00Z");
function readiness(overrides: Record<string, unknown> = {}): ReadinessResponse {
  return evaluateReadiness({
    profile: {
      enabled: false, name: "Asistente", tone: "t", greeting: "g", instructions: "i", escalationRules: "e",
      lastLiveTestAt: null, lastLiveTestPassed: null, updatedAt: t0,
    },
    whatsappConnected: true, aiConfigured: true, liveTestAvailable: false,
    knowledgeCount: 1, knowledgeUpdatedAt: t0,
    latestRun: { id: "r", organizationId: "o", status: "done", score: 90, error: null, startedAt: new Date(t0.getTime() + 1000), finishedAt: new Date(t0.getTime() + 1000) },
    redCount: 0, brandingCustomized: false, teamMemberCount: 1,
    businessHoursConfigured: true, saasMode: true, agendaStep: null,
    ...overrides,
  } as Parameters<typeof evaluateReadiness>[0]);
}

const weekdays = { weeklyHours: { mon: [{ start: "09:00", end: "18:00" }] }, timezone: "America/Caracas", responseMode: "outside_hours" as const };

beforeEach(() => {
  saasMode = true;
  m.canAutomate.mockReset().mockResolvedValue(true);
  m.hasSaaSPlan.mockReset().mockResolvedValue(true);
  m.aiAvailable.mockReset().mockResolvedValue(true);
  m.credentials.mockReset().mockResolvedValue({ status: "connected", displayPhoneNumber: "+58 412 000 0000", verifiedName: "Panadería" });
  m.hours.mockReset().mockResolvedValue(weekdays);
  m.readiness.mockReset().mockResolvedValue(readiness());
});

async function load() {
  return import("@/server/agencia/activacion");
}

describe("activationBlockers", () => {
  it("negocio listo: ningún bloqueo", async () => {
    const { activationBlockers, activationError } = await load();
    const blockers = await activationBlockers("org");
    expect(blockers).toEqual([]);
    expect(activationError(blockers)).toBeNull();
  });

  it("mantiene el orden de siempre: cobro, IA, WhatsApp, plan, horario, pasos", async () => {
    m.canAutomate.mockResolvedValue(false);
    m.aiAvailable.mockResolvedValue(false);
    m.credentials.mockResolvedValue(null);
    m.hours.mockResolvedValue({ weeklyHours: {}, timezone: "America/Caracas", responseMode: "outside_hours" });
    m.readiness.mockResolvedValue(readiness({ knowledgeCount: 0, latestRun: null, businessHoursConfigured: false }));
    const { activationBlockers } = await load();
    const codes = (await activationBlockers("org")).map((b) => b.code);
    expect(codes).toEqual([
      "billing_inactive",
      "ai_not_configured",
      "whatsapp_required",
      "business_hours_required",
      "onboarding_incomplete",
      "onboarding_incomplete",
    ]);
  });

  it("los mensajes de la API no cambian", async () => {
    m.canAutomate.mockResolvedValue(false);
    m.credentials.mockResolvedValue(null);
    const { activationBlockers } = await load();
    const [billing, whatsapp] = await activationBlockers("org");
    expect(billing).toMatchObject({ status: 402, code: "billing_inactive", message: "Activa o recupera tu suscripción para encender Allok." });
    expect(whatsapp).toMatchObject({ status: 409, code: "whatsapp_required", message: "Conecta y verifica tu número de WhatsApp antes de activar Allok." });
  });

  it("una conexión vencida se explica como «reconecta», no como «conecta»", async () => {
    m.credentials.mockResolvedValue({ status: "reconnect_required", displayPhoneNumber: "+58 412 000 0000", verifiedName: null });
    const { activationBlockers } = await load();
    const [blocker] = await activationBlockers("org");
    expect(blocker).toMatchObject({ code: "whatsapp_required", title: "Reconecta tu WhatsApp", cta: "Reconectar" });
    expect(`${blocker!.title} ${blocker!.detail}`).not.toMatch(/token/i);
  });

  it("todo el día sin plan Completo bloquea y manda al horario", async () => {
    m.hours.mockResolvedValue({ ...weekdays, responseMode: "all_day" });
    m.hasSaaSPlan.mockResolvedValue(false);
    const { activationBlockers } = await load();
    expect((await activationBlockers("org"))[0]).toMatchObject({ code: "pro_required", status: 402, href: "/agent#horario" });
  });

  it("una prueba vieja se pide en palabras de dueño", async () => {
    m.readiness.mockResolvedValue(readiness({ knowledgeUpdatedAt: new Date(t0.getTime() + 60_000) }));
    const { activationBlockers } = await load();
    const [blocker] = await activationBlockers("org");
    expect(blocker).toMatchObject({
      code: "onboarding_incomplete",
      step: "probar",
      title: "Vuelve a probar tu agente",
      href: "/lab",
    });
  });

  it("los pasos pendientes se juntan en el mensaje de siempre", async () => {
    m.readiness.mockResolvedValue(readiness({ knowledgeCount: 0, latestRun: null }));
    const { activationBlockers, activationError } = await load();
    expect(activationError(await activationBlockers("org"))).toEqual({
      status: 409,
      code: "onboarding_incomplete",
      message: "Completa antes de activar: Añade información del negocio, Prueba tu agente.",
    });
  });

  it("fuera del SaaS no bloquea nada salvo el cobro", async () => {
    saasMode = false;
    m.credentials.mockResolvedValue(null);
    m.readiness.mockResolvedValue(readiness({ knowledgeCount: 0, latestRun: null }));
    const { activationBlockers } = await load();
    expect(await activationBlockers("org")).toEqual([]);
  });
});

describe("restrictionsOf", () => {
  it("avisa de los límites de Avanzado que siguen puestos al activar", async () => {
    const { restrictionsOf } = await load();
    expect(restrictionsOf(undefined)).toEqual([]);
    expect(restrictionsOf({ allowlistEnabled: false, allowedWaIds: [], activationEnabled: false })).toEqual([]);
    expect(restrictionsOf({ allowlistEnabled: true, allowedWaIds: ["1"], activationEnabled: false })).toEqual([
      "Por ahora solo responde a 1 número autorizado.",
    ]);
    expect(restrictionsOf({ allowlistEnabled: true, allowedWaIds: ["1", "2"], activationEnabled: true })).toHaveLength(2);
  });
});

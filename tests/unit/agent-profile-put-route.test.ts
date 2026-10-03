import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * PUT /api/agent/profile: activar y pausar no tocan la versión del contenido
 * (la prueba sigue vigente), solo un cambio de lo que el agente dice la mueve,
 * y los bloqueos salen de la misma lista que pinta «Activar».
 */

const { requireSession, activationBlockers, encender } = vi.hoisted(() => ({
  requireSession: vi.fn(),
  activationBlockers: vi.fn(),
  encender: vi.fn(async () => 2),
}));
vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/session")>()),
  requireSession,
}));
vi.mock("@/server/agencia/activacion", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/agencia/activacion")>()),
  activationBlockers,
}));
vi.mock("@/server/agencia/ia-inicial", () => ({ encenderConversacionesEnEspera: encender }));
vi.mock("@/server/ai/credentials", () => ({ isAgentAvailableForOrganization: async () => true }));

let saasMode = true;
vi.mock("@/lib/tenant-host", () => ({ isAllokSaaSMode: () => saasMode }));

const state: {
  stored: Record<string, unknown>;
  sets: Record<string, unknown>[];
} = { stored: {}, sets: [] };

vi.mock("@/lib/db", () => ({
  schema: { agentProfile: { organizationId: "organization_id" } },
  getDb: () => ({
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [state.stored] }) }) }),
    update: () => ({
      set: (values: Record<string, unknown>) => {
        state.sets.push(values);
        return {
          where: () => ({
            returning: async () => [{ ...state.stored, ...values }],
          }),
        };
      },
    }),
  }),
}));
vi.mock("@/lib/db/tenant", () => ({ scoped: () => ({}) }));

const stored = (overrides: Record<string, unknown> = {}) => ({
  enabled: false,
  name: "Asistente",
  tone: "Cercano",
  instructions: "Vendemos pan.",
  escalationRules: "Pasa con una persona si piden descuento.",
  greeting: "Hola",
  activationEnabled: false,
  ...overrides,
});

async function put(body: Record<string, unknown>) {
  const { PUT } = await import("@/app/api/agent/profile/route");
  return PUT(new Request("http://localhost/api/agent/profile", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }));
}

beforeEach(() => {
  requireSession.mockReset();
  requireSession.mockResolvedValue({ userId: "owner", organizationId: "org", role: "owner" });
  activationBlockers.mockReset();
  activationBlockers.mockResolvedValue([]);
  encender.mockClear();
  state.sets = [];
  state.stored = stored();
  saasMode = true;
});

describe("PUT /api/agent/profile: la prueba no se invalida por operar", () => {
  it("activar (sin cambios de texto) no mueve updatedAt", async () => {
    const response = await put({ enabled: true });
    expect(response.status).toBe(200);
    expect(state.sets).toHaveLength(1);
    expect(state.sets[0]).toEqual({ enabled: true });
    expect(encender).toHaveBeenCalled();
  });

  it("pausar tampoco mueve updatedAt", async () => {
    state.stored = stored({ enabled: true });
    const response = await put({ enabled: false });
    expect(response.status).toBe(200);
    expect(state.sets[0]).toEqual({ enabled: false });
    expect(state.sets[0]).not.toHaveProperty("updatedAt");
  });

  it("guardar el formulario completo sin cambiar el texto no mueve updatedAt", async () => {
    const response = await put({ name: "Asistente", tone: "Cercano", greeting: "Hola" });
    expect(response.status).toBe(200);
    expect(state.sets[0]).not.toHaveProperty("updatedAt");
  });

  it("cambiar lo que el agente dice sí mueve updatedAt (la prueba queda vieja)", async () => {
    const response = await put({ instructions: "Vendemos pan y pasteles." });
    expect(response.status).toBe(200);
    expect(state.sets[0]).toHaveProperty("updatedAt");
  });

  it("cambiar el proveedor o la allowlist no es cambiar el contenido", async () => {
    await put({ aiProvider: "openai", allowlistEnabled: false });
    expect(state.sets[0]).not.toHaveProperty("updatedAt");
  });
});

describe("PUT /api/agent/profile: activación", () => {
  it("con el agente ya encendido, reenviar enabled:true no vuelve a exigir la puesta en marcha", async () => {
    state.stored = stored({ enabled: true });
    activationBlockers.mockResolvedValue([
      { code: "onboarding_incomplete", status: 409, message: "Prueba tu agente" },
    ]);
    const response = await put({ enabled: true, tone: "Más directo" });
    expect(response.status).toBe(200);
    expect(activationBlockers).not.toHaveBeenCalled();
    expect(state.sets[0]).toHaveProperty("updatedAt");
  });

  it("encender con un bloqueo devuelve el primero, con su código y su mensaje de siempre", async () => {
    activationBlockers.mockResolvedValue([
      { code: "whatsapp_required", status: 409, message: "Conecta y verifica tu número de WhatsApp antes de activar Allok." },
      { code: "onboarding_incomplete", status: 409, message: "Prueba tu agente" },
    ]);
    const response = await put({ enabled: true });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: { code: "whatsapp_required", message: "Conecta y verifica tu número de WhatsApp antes de activar Allok." },
    });
    expect(state.sets).toHaveLength(0);
  });

  it("junta los pasos pendientes en el mensaje de siempre", async () => {
    activationBlockers.mockResolvedValue([
      { code: "onboarding_incomplete", status: 409, message: "Añade información del negocio" },
      { code: "onboarding_incomplete", status: 409, message: "Prueba tu agente" },
    ]);
    const response = await put({ enabled: true });
    expect(response.status).toBe(409);
    expect((await response.json()).error.message).toBe(
      "Completa antes de activar: Añade información del negocio, Prueba tu agente.",
    );
  });

  it("editar el texto y encender en la misma petición se rechaza: esa edición no pasó por la prueba", async () => {
    const response = await put({ enabled: true, instructions: "Ahora vendemos tortas." });
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("content_changed");
    expect(state.sets).toHaveLength(0);
  });

  it("fuera del SaaS esa combinación se permite (no hay prueba que exigir)", async () => {
    saasMode = false;
    const response = await put({ enabled: true, instructions: "Ahora vendemos tortas." });
    expect(response.status).toBe(200);
  });
});

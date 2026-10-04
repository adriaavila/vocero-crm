import { beforeEach, describe, expect, it, vi } from "vitest";

// La primera importación de una ruta compila medio proyecto: con la máquina cargada pasa de 5 s.
vi.setConfig({ testTimeout: 30_000 });

/** Cambiar la clave o el modelo de IA cambia lo que el agente contesta: la prueba anterior ya no vale. */

const { requireSession, touch, probe } = vi.hoisted(() => ({
  requireSession: vi.fn(),
  touch: vi.fn(async () => {}),
  probe: vi.fn(),
}));
vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/session")>()),
  requireSession,
}));
vi.mock("@/server/agencia/version-contenido", () => ({ touchAgentContent: touch }));
vi.mock("@/lib/ai", () => ({ probeAiProvider: probe }));
vi.mock("@/server/ai/credentials", () => ({
  saveAiCredential: vi.fn(async () => {}),
  deleteAiCredential: vi.fn(async () => {}),
  listAiCredentialStatuses: vi.fn(async () => ({})),
}));

beforeEach(() => {
  requireSession.mockReset();
  requireSession.mockResolvedValue({ userId: "owner", organizationId: "org", role: "owner" });
  touch.mockClear();
  probe.mockReset();
});

describe("/api/agent/credentials", () => {
  it("guardar una clave válida mueve la versión del contenido", async () => {
    probe.mockResolvedValue({ ok: true });
    const { PUT } = await import("@/app/api/agent/credentials/route");
    const response = await PUT(new Request("http://localhost/api/agent/credentials", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: "openrouter", apiKey: "sk-test", model: "otro-modelo" }),
    }));
    expect(response.status).toBe(200);
    expect(touch).toHaveBeenCalledWith("org");
  });

  it("una clave que no se pudo validar no cambia nada", async () => {
    probe.mockResolvedValue({ ok: false });
    const { PUT } = await import("@/app/api/agent/credentials/route");
    const response = await PUT(new Request("http://localhost/api/agent/credentials", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: "openrouter", apiKey: "sk-malo" }),
    }));
    expect(response.status).toBe(422);
    expect(touch).not.toHaveBeenCalled();
  });

  it("volver a la clave de la plataforma también la mueve", async () => {
    const { DELETE } = await import("@/app/api/agent/credentials/route");
    const response = await DELETE(new Request("http://localhost/api/agent/credentials?provider=openrouter", { method: "DELETE" }));
    expect(response.status).toBe(200);
    expect(touch).toHaveBeenCalledWith("org");
  });
});

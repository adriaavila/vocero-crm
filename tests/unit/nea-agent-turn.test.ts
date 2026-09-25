import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `runAgentTurn` con Nea configurada (isNeaBrain()): el CRM reúne lo que Nea
 * necesita y le despacha el turno completo — NUNCA llama al LLM interno. Los
 * gates que sí quedan del lado del CRM: conversación y perfil existen,
 * `profile.enabled` para conversaciones reales, handoff/IA-apagada (con la
 * excepción de activación por mensajes) y al menos un mensaje entrante.
 */

const { chatJson, dispatchToNea } = vi.hoisted(() => ({
  chatJson: vi.fn(),
  dispatchToNea: vi.fn(),
}));
vi.mock("@/lib/ai", () => ({ chatJson }));
vi.mock("@/server/ai/nea-dispatch", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/ai/nea-dispatch")>();
  return { ...actual, dispatchToNea };
});

const selectQueue: unknown[][] = [];
function chain(rows: unknown[]) {
  const c: Record<string, unknown> = {};
  for (const m of ["from", "where", "orderBy", "leftJoin"]) c[m] = () => c;
  c.limit = () => Promise.resolve(rows);
  return c;
}

vi.mock("@/lib/db", () => ({
  getDb: () => ({ select: () => chain(selectQueue.shift() ?? []) }),
  schema: new Proxy(
    {},
    {
      get: (_t, tableName) =>
        new Proxy({}, { get: (_t2, col) => `${String(tableName)}.${String(col)}` }),
    }
  ),
}));

import { runAgentTurn } from "@/server/ai/pipeline";

const CONVERSATION = {
  id: "cv_1",
  organizationId: "org_1",
  contactId: "ct_1",
  isTest: false,
  aiEnabled: true,
  handoffAt: null as Date | null,
};

const PROFILE = { enabled: true, activationEnabled: false };

const CONTACT = { waIdentity: "5215512345678", name: "Ana" };

const INBOUND_MESSAGE = {
  id: "msg_1",
  waMessageId: "wamid.1",
  direction: "in" as const,
  type: "text",
  text: "hola",
  waTimestamp: null,
  createdAt: new Date("2026-09-25T12:00:00.000Z"),
  mediaWaId: null,
};

describe("runAgentTurn con Nea", () => {
  beforeEach(() => {
    selectQueue.length = 0;
    chatJson.mockReset();
    dispatchToNea.mockReset().mockResolvedValue(undefined);
    vi.stubEnv("ALLOK_SAAS_MODE", ""); // fuera de SaaS: no hace falta mockear canAgentRespondNow
    vi.stubEnv("BOT_API_KEY", "clave-compartida-con-nea-larga");
    vi.stubEnv("NEA_DISPATCH_URL", "http://nea-agent:8000/dispatch");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("conversación normal → despacha a Nea y jamás llama al LLM interno", async () => {
    selectQueue.push([CONVERSATION], [PROFILE], [CONTACT], [INBOUND_MESSAGE]);

    await runAgentTurn("cv_1");

    expect(chatJson).not.toHaveBeenCalled();
    expect(dispatchToNea).toHaveBeenCalledTimes(1);
    expect(dispatchToNea).toHaveBeenCalledWith({
      organizationId: "org_1",
      conversationId: "cv_1",
      isTest: false,
      contact: { identity: "5215512345678", name: "Ana" },
      messages: [
        { id: "wamid.1", type: "text", text: "hola", mediaId: null, timestamp: "2026-09-25T12:00:00.000Z" },
      ],
    });
  });

  it("sin perfil → no despacha", async () => {
    selectQueue.push([CONVERSATION], []);

    await runAgentTurn("cv_1");

    expect(dispatchToNea).not.toHaveBeenCalled();
  });

  it("agente apagado (profile.enabled=false) en conversación real → no despacha", async () => {
    selectQueue.push([CONVERSATION], [{ ...PROFILE, enabled: false }]);

    await runAgentTurn("cv_1");

    expect(dispatchToNea).not.toHaveBeenCalled();
  });

  it("agente apagado pero conversación de prueba (Laboratorio) → despacha igual", async () => {
    selectQueue.push(
      [{ ...CONVERSATION, isTest: true }],
      [{ ...PROFILE, enabled: false }],
      [CONTACT],
      [INBOUND_MESSAGE]
    );

    await runAgentTurn("cv_1");

    expect(dispatchToNea).toHaveBeenCalledTimes(1);
  });

  it("handoff activo, sin activación por mensajes → no despacha", async () => {
    selectQueue.push([{ ...CONVERSATION, handoffAt: new Date() }], [PROFILE]);

    await runAgentTurn("cv_1");

    expect(dispatchToNea).not.toHaveBeenCalled();
  });

  it("IA apagada en la conversación, sin activación → no despacha", async () => {
    selectQueue.push([{ ...CONVERSATION, aiEnabled: false }], [PROFILE]);

    await runAgentTurn("cv_1");

    expect(dispatchToNea).not.toHaveBeenCalled();
  });

  it("conversación pausada CON activación por mensajes habilitada → despacha (Nea necesita verla para reactivarla)", async () => {
    selectQueue.push(
      [{ ...CONVERSATION, handoffAt: new Date(), aiEnabled: false }],
      [{ ...PROFILE, activationEnabled: true }],
      [CONTACT],
      [INBOUND_MESSAGE]
    );

    await runAgentTurn("cv_1");

    expect(dispatchToNea).toHaveBeenCalledTimes(1);
  });

  it("sin mensajes entrantes que despachar → no despacha", async () => {
    selectQueue.push([CONVERSATION], [PROFILE], [CONTACT], []);

    await runAgentTurn("cv_1");

    expect(dispatchToNea).not.toHaveBeenCalled();
  });

  it("sin conversación → no despacha", async () => {
    selectQueue.push([]);

    await runAgentTurn("cv_1");

    expect(dispatchToNea).not.toHaveBeenCalled();
  });
});

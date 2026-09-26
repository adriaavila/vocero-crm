import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `runAgentTurn` con Nea configurada (isNeaBrain()): el CRM reúne lo que Nea
 * necesita y le despacha el turno completo — NUNCA llama al LLM interno. Los
 * gates que sí quedan del lado del CRM: conversación y perfil existen,
 * `profile.enabled` para conversaciones reales, handoff/IA-apagada (con la
 * excepción de activación por mensajes) y automatización/horario.
 *
 * Dispatch v2: el ensamblado del snapshot (`buildNeaTurnSnapshot`) se prueba
 * aparte (`nea-payload.test.ts`) — aquí se mockea, y lo que se verifica es la
 * ORQUESTACIÓN: qué gates paran el turno ANTES de intentar construir nada, y
 * que la selección v1 (`messages`, CONGELADA) sigue viajando igual que
 * siempre dentro del snapshot que se le pide a `buildNeaTurnSnapshot`.
 * El loop de reintentos (dispatchId estable, dedupe por id determinista,
 * cursor, eco de handoff/llm) se prueba en `nea-turn-retry.test.ts`.
 */

const { chatJson, dispatchToNea, canAutomate, buildNeaTurnSnapshot } = vi.hoisted(() => ({
  chatJson: vi.fn(),
  dispatchToNea: vi.fn(),
  canAutomate: vi.fn(async () => true),
  buildNeaTurnSnapshot: vi.fn(),
}));
vi.mock("@/lib/ai", () => ({ chatJson }));
vi.mock("@/server/ai/nea-dispatch", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/ai/nea-dispatch")>();
  return { ...actual, dispatchToNea };
});
vi.mock("@/server/ai/nea-payload", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/ai/nea-payload")>();
  return { ...actual, buildNeaTurnSnapshot };
});
vi.mock("@/server/agencia/entitlements", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/agencia/entitlements")>();
  return { ...actual, canAutomate };
});

const selectQueue: unknown[][] = [];
const updates: Record<string, unknown>[] = [];
function chain(rows: unknown[]) {
  const c: Record<string, unknown> = {};
  for (const m of ["from", "where", "orderBy", "leftJoin"]) c[m] = () => c;
  c.limit = () => Promise.resolve(rows);
  return c;
}

/**
 * `advanceCursor` hace `await db.update(...).set(...).where(...)` (SIN
 * `.returning()`), y `applyHandoff` hace lo mismo pero CON `.returning()` —
 * la cadena debe servir los dos estilos.
 */
function updateChain(): Record<string, unknown> {
  const c: Record<string, unknown> = {};
  c.where = () => c;
  c.returning = () => Promise.resolve([{ id: "cv_1" }]);
  (c as { then: unknown }).then = (resolve: (v: unknown) => unknown) => resolve(undefined);
  return c;
}

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => chain(selectQueue.shift() ?? []),
    update: () => ({
      set: (values: Record<string, unknown>) => {
        updates.push(values);
        return updateChain();
      },
    }),
  }),
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
  agentCursorAt: null as Date | null,
  memoryResetAt: null as Date | null,
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

/** Snapshot mínimo válido — solo interesa que `buildNeaTurnSnapshot` NO devuelva null. */
function snapshot(overrides: Partial<Parameters<typeof dispatchToNea>[0]> = {}) {
  return {
    payload: {
      organizationId: "org_1",
      conversationId: "cv_1",
      isTest: false,
      contact: { identity: "5215512345678", name: "Ana" },
      messages: [],
      version: 2 as const,
      dispatchId: "dsp_test",
      attempt: 0,
      context: {},
      profile: {},
      history: [],
      offers: [],
      llm: null,
      ...overrides,
    },
    pendingIds: ["msg_pending_1"],
    orgCredential: null,
  };
}

describe("runAgentTurn con Nea", () => {
  beforeEach(() => {
    selectQueue.length = 0;
    updates.length = 0;
    chatJson.mockReset();
    dispatchToNea.mockReset().mockResolvedValue({ kind: "ok", body: { ok: true, action: "noop" } });
    buildNeaTurnSnapshot.mockReset().mockResolvedValue(snapshot());
    canAutomate.mockReset().mockResolvedValue(true);
    vi.stubEnv("ALLOK_SAAS_MODE", ""); // fuera de SaaS: no hace falta mockear canAgentRespondNow
    vi.stubEnv("BOT_API_KEY", "clave-compartida-con-nea-larga");
    vi.stubEnv("NEA_DISPATCH_URL", "http://nea-agent:8000/dispatch");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("conversación normal → despacha a Nea y jamás llama al LLM interno", async () => {
    selectQueue.push([CONVERSATION], [PROFILE], [CONTACT], [INBOUND_MESSAGE]);

    await runAgentTurn("cv_1");

    expect(chatJson).not.toHaveBeenCalled();
    expect(buildNeaTurnSnapshot).toHaveBeenCalledTimes(1);
    expect(buildNeaTurnSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org_1",
        conversationId: "cv_1",
        isTest: false,
        contact: { identity: "5215512345678", name: "Ana" },
        // v1 (`messages`) CONGELADO: misma selección de siempre.
        v1Messages: [
          expect.objectContaining({ id: "msg_1", waMessageId: "wamid.1", text: "hola" }),
        ],
      })
    );
    expect(dispatchToNea).toHaveBeenCalledTimes(1);
  });

  it("sin perfil → no despacha", async () => {
    selectQueue.push([CONVERSATION], []);

    await runAgentTurn("cv_1");

    expect(buildNeaTurnSnapshot).not.toHaveBeenCalled();
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

  it("Laboratorio: SOLO manda los entrantes después del último saliente (a diferencia de una conversación real) — sigue viajando en v1Messages", async () => {
    const vieja = {
      id: "msg_0",
      waMessageId: null,
      direction: "in" as const,
      type: "text",
      text: "mensaje viejo",
      waTimestamp: null,
      createdAt: new Date("2026-09-25T11:00:00.000Z"),
      mediaWaId: null,
    };
    const respuestaDelAgente = {
      id: "msg_r",
      waMessageId: null,
      direction: "out" as const,
      type: "text",
      text: "respuesta del agente",
      waTimestamp: null,
      createdAt: new Date("2026-09-25T11:00:05.000Z"),
      mediaWaId: null,
    };
    const nueva = {
      id: "msg_1",
      waMessageId: null,
      direction: "in" as const,
      type: "text",
      text: "pregunta nueva",
      waTimestamp: null,
      createdAt: new Date("2026-09-25T11:00:10.000Z"),
      mediaWaId: null,
    };
    // El query real pide `orderBy(desc(createdAt))` y el pipeline hace
    // `.reverse()` después — el mock de la BD no ordena solo, así que la fila
    // "más nueva primero" hay que dársela ya en ese orden.
    selectQueue.push(
      [{ ...CONVERSATION, isTest: true }],
      [PROFILE],
      [CONTACT],
      [nueva, respuestaDelAgente, vieja]
    );

    await runAgentTurn("cv_1");

    expect(buildNeaTurnSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        v1Messages: [expect.objectContaining({ id: "msg_1", text: "pregunta nueva" })],
      })
    );
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

  it("nada pendiente (buildNeaTurnSnapshot → null) → no despacha", async () => {
    buildNeaTurnSnapshot.mockResolvedValue(null);
    selectQueue.push([CONVERSATION], [PROFILE], [CONTACT], []);

    await runAgentTurn("cv_1");

    expect(dispatchToNea).not.toHaveBeenCalled();
  });

  it("sin conversación → no despacha", async () => {
    selectQueue.push([]);

    await runAgentTurn("cv_1");

    expect(dispatchToNea).not.toHaveBeenCalled();
  });

  it("automatización pausada (canAutomate=false) en conversación real → no despacha", async () => {
    canAutomate.mockResolvedValueOnce(false);
    selectQueue.push([CONVERSATION], [PROFILE]);

    await runAgentTurn("cv_1");

    expect(dispatchToNea).not.toHaveBeenCalled();
    expect(canAutomate).toHaveBeenCalledWith("org_1");
  });

  it("el Laboratorio ignora el freno de facturación (canAutomate no debería importar en pruebas)", async () => {
    canAutomate.mockResolvedValueOnce(false);
    selectQueue.push(
      [{ ...CONVERSATION, isTest: true }],
      [PROFILE],
      [CONTACT],
      [INBOUND_MESSAGE]
    );

    await runAgentTurn("cv_1");

    expect(dispatchToNea).toHaveBeenCalledTimes(1);
  });

  it("conversación real: manda hasta los últimos entrantes de la ventana, no solo 'desde el último saliente' — un mensaje que llega mientras un despacho sigue en vuelo aparece en el SIGUIENTE turno aunque ya hubiera uno antes", async () => {
    const hola = {
      id: "msg_1",
      waMessageId: "wamid.1",
      direction: "in" as const,
      type: "text",
      text: "hola",
      waTimestamp: null,
      createdAt: new Date("2026-09-25T12:00:00.000Z"),
      mediaWaId: null,
    };
    const siguenAhi = {
      id: "msg_2",
      waMessageId: "wamid.2",
      direction: "in" as const,
      type: "text",
      text: "¿siguen ahí?",
      waTimestamp: null,
      createdAt: new Date("2026-09-25T12:00:05.000Z"),
      mediaWaId: null,
    };
    const holaOtraVez = {
      id: "msg_3",
      waMessageId: "wamid.3",
      direction: "in" as const,
      type: "text",
      text: "hola??",
      waTimestamp: null,
      createdAt: new Date("2026-09-25T12:00:10.000Z"),
      mediaWaId: null,
    };

    selectQueue.push([CONVERSATION], [PROFILE], [CONTACT], [hola]);
    await runAgentTurn("cv_1");
    expect(buildNeaTurnSnapshot).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        v1Messages: [expect.objectContaining({ id: "msg_1", text: "hola" })],
      })
    );

    // Igual que arriba: el mock no ordena, así que se entrega ya en el orden
    // "más nuevo primero" que da `orderBy(desc(createdAt))`.
    selectQueue.push([CONVERSATION], [PROFILE], [CONTACT], [holaOtraVez, siguenAhi, hola]);
    await runAgentTurn("cv_1");
    expect(buildNeaTurnSnapshot).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        v1Messages: [
          expect.objectContaining({ id: "msg_1", text: "hola" }),
          expect.objectContaining({ id: "msg_2", text: "¿siguen ahí?" }),
          expect.objectContaining({ id: "msg_3", text: "hola??" }),
        ],
      })
    );
  });
});

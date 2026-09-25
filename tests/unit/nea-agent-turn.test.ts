import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `runAgentTurn` con Nea configurada (isNeaBrain()): el CRM reúne lo que Nea
 * necesita y le despacha el turno completo — NUNCA llama al LLM interno. Los
 * gates que sí quedan del lado del CRM: conversación y perfil existen,
 * `profile.enabled` para conversaciones reales, handoff/IA-apagada (con la
 * excepción de activación por mensajes) y al menos un mensaje entrante.
 */

const { chatJson, dispatchToNea, canAutomate } = vi.hoisted(() => ({
  chatJson: vi.fn(),
  dispatchToNea: vi.fn(),
  canAutomate: vi.fn(async () => true),
}));
vi.mock("@/lib/ai", () => ({ chatJson }));
vi.mock("@/server/ai/nea-dispatch", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/ai/nea-dispatch")>();
  return { ...actual, dispatchToNea };
});
vi.mock("@/server/agencia/entitlements", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/agencia/entitlements")>();
  return { ...actual, canAutomate };
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

  it("Laboratorio: SOLO manda los entrantes después del último saliente (a diferencia de una conversación real)", async () => {
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

    expect(dispatchToNea).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [
          { id: null, type: "text", text: "pregunta nueva", mediaId: null, timestamp: "2026-09-25T11:00:10.000Z" },
        ],
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

  it("conversación real: manda hasta los últimos entrantes de la ventana, no solo 'desde el último saliente' — un mensaje que llega mientras un despacho sigue en vuelo aparece en el SIGUIENTE despacho aunque ya hubiera uno antes", async () => {
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

    // Primer turno: solo llegó "hola". El despacho a Nea queda en vuelo (aún
    // no hay saliente en la conversación — la respuesta ni siquiera se guardó).
    selectQueue.push([CONVERSATION], [PROFILE], [CONTACT], [hola]);
    await runAgentTurn("cv_1");
    expect(dispatchToNea).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        messages: [
          { id: "wamid.1", type: "text", text: "hola", mediaId: null, timestamp: "2026-09-25T12:00:00.000Z" },
        ],
      })
    );

    // Mientras el primer despacho seguía en vuelo llegaron dos más. Como la
    // conversación real manda "los últimos entrantes de la ventana" (no
    // "desde el último saliente", que aquí seguiría sin existir), el segundo
    // turno ve las TRES — Nea dedupea `wamid.1` por id y solo actúa sobre las
    // dos nuevas. Con la estrategia vieja, un entrante que llegaba entre
    // turnos podía quedar fuera de todo despacho.
    // Igual que arriba: el mock no ordena, así que se entrega ya en el orden
    // "más nuevo primero" que da `orderBy(desc(createdAt))`.
    selectQueue.push([CONVERSATION], [PROFILE], [CONTACT], [holaOtraVez, siguenAhi, hola]);
    await runAgentTurn("cv_1");
    expect(dispatchToNea).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        messages: [
          { id: "wamid.1", type: "text", text: "hola", mediaId: null, timestamp: "2026-09-25T12:00:00.000Z" },
          { id: "wamid.2", type: "text", text: "¿siguen ahí?", mediaId: null, timestamp: "2026-09-25T12:00:05.000Z" },
          { id: "wamid.3", type: "text", text: "hola??", mediaId: null, timestamp: "2026-09-25T12:00:10.000Z" },
        ],
      })
    );
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Ensamblado del payload de dispatch v2 (`server/ai/nea-payload.ts`).
 *
 * `computePendingCutoff` se prueba pura, sin BD — documenta la LÓGICA de
 * selección, pero el turno real ya no la usa para comparar (ver el
 * comentario en el propio `nea-payload.ts`): `agent_cursor_at` se fija
 * EXACTO al `created_at` de un mensaje (microsegundos), y cualquier
 * comparación que pasara por un `Date` de JS (milisegundos) perdía esa
 * parte fraccionaria — el mensaje recién contestado volvía a parecer
 * "pendiente" en el turno siguiente. El cálculo real (`pendingCutoffExpr`,
 * `memoryResetAtExpr`) vive entero en SQL, con subconsultas embebidas, y NO
 * es mockeable con un `getDb()` falso — se verifica contra Postgres de
 * verdad en `nea-payload-realdb.test.ts` (opcional, se salta sin
 * `REALDB_TEST_DATABASE_URL`).
 *
 * `buildNeaTurnSnapshot` se prueba aquí con `buildHistoryAndPending` TAMBIÉN
 * mockeada (además de `buildBotContext`/`buildBotProfile`/`getOffers`/
 * `getNeaLlmCredential`): lo que este archivo cubre es el ENSAMBLADO
 * (dispatchId/attempt, v1 congelado, offers futuro-solo, llm nunca de
 * plataforma), no la mecánica SQL del historial/pendientes.
 */

const { buildBotContext, buildBotProfile, getOffers, getNeaLlmCredential, buildHistoryAndPending } = vi.hoisted(
  () => ({
    buildBotContext: vi.fn(),
    buildBotProfile: vi.fn(),
    getOffers: vi.fn(),
    getNeaLlmCredential: vi.fn(),
    buildHistoryAndPending: vi.fn(),
  })
);
vi.mock("@/server/bot/context", () => ({ buildBotContext }));
vi.mock("@/server/bot/profile", () => ({ buildBotProfile }));
vi.mock("@/server/agenda/offers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/agenda/offers")>();
  return { ...actual, getOffers };
});
vi.mock("@/server/ai/credentials", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/ai/credentials")>();
  return { ...actual, getNeaLlmCredential };
});

vi.mock("@/server/ai/nea-history", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/ai/nea-history")>();
  return { ...actual, buildHistoryAndPending };
});

import { computePendingCutoff, buildNeaTurnSnapshot } from "@/server/ai/nea-payload";

const CONTEXT = { contact: {}, conversation: {}, lead: null, agentAccess: {}, booking: { next: null }, adOrigen: null };
const PROFILE = { profile: { name: "Nea" }, kb: "", resources: [] };
const HISTORY_RESULT = { history: [], pendingIds: ["msg_pending_1"] };

describe("computePendingCutoff", () => {
  const NOW = new Date("2026-09-25T12:00:00.000Z");
  const DAY_AGO = new Date("2026-09-24T12:00:00.000Z");

  it("sin ningún candidato → cae a now-24h", () => {
    const cutoff = computePendingCutoff({
      agentCursorAt: null,
      lastAiOutboundAt: null,
      memoryResetAt: null,
      lastHumanOutboundAt: null,
      now: NOW,
    });
    expect(cutoff).toEqual(DAY_AGO);
  });

  it("el cursor gana si es más nuevo que los demás", () => {
    const cursor = new Date("2026-09-25T10:00:00.000Z");
    const cutoff = computePendingCutoff({
      agentCursorAt: cursor,
      lastAiOutboundAt: new Date("2026-09-20T00:00:00.000Z"), // se ignora: hay cursor
      memoryResetAt: null,
      lastHumanOutboundAt: null,
      now: NOW,
    });
    expect(cutoff).toEqual(cursor);
  });

  it("cursor NULL → cae al último saliente `ai` como fallback", () => {
    const lastAi = new Date("2026-09-25T09:00:00.000Z");
    const cutoff = computePendingCutoff({
      agentCursorAt: null,
      lastAiOutboundAt: lastAi,
      memoryResetAt: null,
      lastHumanOutboundAt: null,
      now: NOW,
    });
    expect(cutoff).toEqual(lastAi);
  });

  it("memory_reset_at gana si es el más nuevo", () => {
    const reset = new Date("2026-09-25T11:00:00.000Z");
    const cutoff = computePendingCutoff({
      agentCursorAt: new Date("2026-09-20T00:00:00.000Z"),
      lastAiOutboundAt: null,
      memoryResetAt: reset,
      lastHumanOutboundAt: null,
      now: NOW,
    });
    expect(cutoff).toEqual(reset);
  });

  it("el último saliente humano (operador/manual/plantilla) gana si es el más nuevo", () => {
    const human = new Date("2026-09-25T11:30:00.000Z");
    const cutoff = computePendingCutoff({
      agentCursorAt: new Date("2026-09-20T00:00:00.000Z"),
      lastAiOutboundAt: null,
      memoryResetAt: null,
      lastHumanOutboundAt: human,
      now: NOW,
    });
    expect(cutoff).toEqual(human);
  });

  it("es siempre el MÁXIMO de los cuatro, no un orden de prioridad fijo", () => {
    const cutoff = computePendingCutoff({
      agentCursorAt: new Date("2026-09-01T00:00:00.000Z"),
      lastAiOutboundAt: null,
      memoryResetAt: new Date("2026-09-10T00:00:00.000Z"),
      lastHumanOutboundAt: new Date("2026-09-05T00:00:00.000Z"),
      now: NOW, // now-24h = 2026-09-24, más nuevo que los tres anteriores
    });
    expect(cutoff).toEqual(DAY_AGO);
  });

  it("trata `undefined` (mock/legado sin el campo) igual que `null`, no lo deja pasar al Math.max", () => {
    const cutoff = computePendingCutoff({
      agentCursorAt: undefined as unknown as null,
      lastAiOutboundAt: null,
      memoryResetAt: undefined as unknown as null,
      lastHumanOutboundAt: null,
      now: NOW,
    });
    expect(cutoff).toEqual(DAY_AGO);
  });
});

describe("buildNeaTurnSnapshot", () => {
  const BASE_INPUT = {
    organizationId: "org_1",
    conversationId: "cv_1",
    isTest: false,
    dispatchId: "dsp_1",
    attempt: 0,
    contact: { identity: "5215512345678", name: "Ana" },
    v1Messages: [],
  };

  beforeEach(() => {
    buildBotContext.mockReset().mockResolvedValue(CONTEXT);
    buildBotProfile.mockReset().mockResolvedValue(PROFILE);
    getOffers.mockReset().mockResolvedValue([]);
    getNeaLlmCredential.mockReset().mockResolvedValue(null);
    buildHistoryAndPending.mockReset().mockResolvedValue(HISTORY_RESULT);
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("OPENROUTER_API_TOKEN", "");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("nada pendiente (buildHistoryAndPending → null) → null: no se despacha", async () => {
    buildHistoryAndPending.mockResolvedValue(null);
    const result = await buildNeaTurnSnapshot(BASE_INPUT);
    expect(result).toBeNull();
    // ni siquiera se molesta en construir context/profile/offers/llm.
    expect(buildBotContext).not.toHaveBeenCalled();
  });

  it("history y pendingIds son EXACTAMENTE lo que devuelve buildHistoryAndPending", async () => {
    const history = [{ id: "m1", role: "lead" as const, type: "text", text: "hola", at: "2026-09-25T12:00:00.000Z", pending: true, media: null }];
    buildHistoryAndPending.mockResolvedValue({ history, pendingIds: ["m1"] });
    const result = await buildNeaTurnSnapshot(BASE_INPUT);
    expect(result!.payload.history).toBe(history);
    expect(result!.pendingIds).toEqual(["m1"]);
  });

  it("llm: null sin clave propia de la organización — nunca manda la de plataforma", async () => {
    vi.stubEnv("OPENAI_API_KEY", "clave-de-plataforma-secreta");
    vi.stubEnv("OPENROUTER_API_TOKEN", "otra-clave-de-plataforma");
    getNeaLlmCredential.mockResolvedValue(null); // la org no tiene propia

    const result = await buildNeaTurnSnapshot(BASE_INPUT);
    expect(result!.payload.llm).toBeNull();
    expect(JSON.stringify(result!.payload)).not.toContain("clave-de-plataforma-secreta");
    expect(JSON.stringify(result!.payload)).not.toContain("otra-clave-de-plataforma");
  });

  it("llm: con clave propia, viaja {provider, model, apiKey} — exactamente lo que devolvió getNeaLlmCredential", async () => {
    getNeaLlmCredential.mockResolvedValue({
      provider: "openrouter",
      model: "z-ai/glm-5.3-flash",
      apiKey: "sk-org-propia",
      keyIv: "iv-actual",
    });

    const result = await buildNeaTurnSnapshot(BASE_INPUT);
    expect(result!.payload.llm).toEqual({
      provider: "openrouter",
      model: "z-ai/glm-5.3-flash",
      apiKey: "sk-org-propia",
    });
    expect(result!.orgCredential).toEqual({ provider: "openrouter", keyIv: "iv-actual" });
  });

  it("offers: solo las futuras (startUtc > now)", async () => {
    const now = Date.now();
    getOffers.mockResolvedValue([
      { startUtc: new Date(now - 60_000).toISOString(), label: "ya pasó" },
      { startUtc: new Date(now + 60_000).toISOString(), label: "futura" },
    ]);

    const result = await buildNeaTurnSnapshot(BASE_INPUT);
    expect(result!.payload.offers).toEqual([{ startUtc: expect.any(String), label: "futura" }]);
  });

  it("dispatchId y attempt viajan tal cual en el payload", async () => {
    const result = await buildNeaTurnSnapshot({ ...BASE_INPUT, dispatchId: "dsp_xyz", attempt: 2 });
    expect(result!.payload.dispatchId).toBe("dsp_xyz");
    expect(result!.payload.attempt).toBe(2);
    expect(result!.payload.version).toBe(2);
  });

  it("context y profile son EXACTAMENTE lo que devuelven buildBotContext/buildBotProfile", async () => {
    const result = await buildNeaTurnSnapshot(BASE_INPUT);
    expect(result!.payload.context).toBe(CONTEXT);
    expect(result!.payload.profile).toBe(PROFILE);
    expect(buildBotContext).toHaveBeenCalledWith("org_1", "cv_1");
    expect(buildBotProfile).toHaveBeenCalledWith("org_1");
  });

  it("v1 (`messages`, `contact`, `isTest`) viaja tal cual lo recibido — CONGELADO", async () => {
    const v1Messages = [
      {
        id: "m1",
        waMessageId: "wamid.9",
        direction: "in" as const,
        type: "text",
        text: "hola v1",
        mediaWaId: null,
        timestamp: new Date("2026-09-25T12:00:00.000Z"),
      },
    ];
    const result = await buildNeaTurnSnapshot({ ...BASE_INPUT, v1Messages, isTest: true });
    expect(result!.payload.messages).toEqual([
      { id: "wamid.9", type: "text", text: "hola v1", mediaId: null, timestamp: "2026-09-25T12:00:00.000Z" },
    ]);
    expect(result!.payload.isTest).toBe(true);
    expect(result!.payload.contact).toEqual({ identity: "5215512345678", name: "Ana" });
  });
});

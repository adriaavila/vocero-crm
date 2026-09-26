import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Ensamblado del payload de dispatch v2 (`server/ai/nea-payload.ts`).
 *
 * `computePendingCutoff` se prueba pura, sin BD. `buildNeaTurnSnapshot` se
 * prueba con `buildBotContext`/`buildBotProfile`/`getOffers`/
 * `getNeaLlmCredential` mockeados (cada uno tiene su propia suite) y una cola
 * de filas para las consultas crudas de historial/pendientes que sí vive
 * aquí.
 */

const CONTEXT = { contact: {}, conversation: {}, lead: null, agentAccess: {}, booking: { next: null }, adOrigen: null };
const PROFILE = { profile: { name: "Nea" }, kb: "", resources: [] };

const { buildBotContext, buildBotProfile, getOffers, getNeaLlmCredential } = vi.hoisted(() => ({
  buildBotContext: vi.fn(),
  buildBotProfile: vi.fn(),
  getOffers: vi.fn(),
  getNeaLlmCredential: vi.fn(),
}));
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

/** Cola de filas por consulta, en el ORDEN exacto en que `buildHistoryAndPending`
 * las dispara: lastAi, lastHuman, pending, history. */
const rowQueue: unknown[][] = [];
function chain(rows: unknown[]) {
  const c: Record<string, unknown> = {};
  for (const m of ["from", "where", "orderBy", "leftJoin"]) c[m] = () => c;
  c.limit = () => Promise.resolve(rows);
  return c;
}
vi.mock("@/lib/db", () => ({
  getDb: () => ({ select: () => chain(rowQueue.shift() ?? []) }),
  schema: new Proxy(
    {},
    { get: (_t, tableName) => new Proxy({}, { get: (_t2, col) => `${String(tableName)}.${String(col)}` }) }
  ),
}));

import { computePendingCutoff, buildNeaTurnSnapshot } from "@/server/ai/nea-payload";

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
  const INBOUND = (over: Partial<Record<string, unknown>> = {}) => ({
    id: "msg_in",
    organizationId: "org_1",
    conversationId: "cv_1",
    waMessageId: "wamid.1",
    direction: "in" as const,
    type: "text",
    text: "hola",
    status: "delivered",
    error: null,
    aiGenerated: false,
    origin: "operator" as const,
    mediaAssetId: null,
    transcript: null,
    waTimestamp: null,
    createdAt: new Date("2026-09-25T12:00:00.000Z"),
    ...over,
  });
  const OUTBOUND = (over: Partial<Record<string, unknown>> = {}) => ({
    id: "msg_out",
    organizationId: "org_1",
    conversationId: "cv_1",
    waMessageId: "wamid.2",
    direction: "out" as const,
    type: "text",
    text: "hola de vuelta",
    status: "sent",
    error: null,
    aiGenerated: true,
    origin: "ai" as const,
    mediaAssetId: null,
    transcript: null,
    waTimestamp: null,
    createdAt: new Date("2026-09-25T12:05:00.000Z"),
    ...over,
  });

  const BASE_INPUT = {
    organizationId: "org_1",
    conversationId: "cv_1",
    isTest: false,
    dispatchId: "dsp_1",
    attempt: 0,
    contact: { identity: "5215512345678", name: "Ana" },
    memoryResetAt: null as Date | null,
    agentCursorAt: null as Date | null,
    v1Messages: [],
  };

  beforeEach(() => {
    rowQueue.length = 0;
    buildBotContext.mockReset().mockResolvedValue(CONTEXT);
    buildBotProfile.mockReset().mockResolvedValue(PROFILE);
    getOffers.mockReset().mockResolvedValue([]);
    getNeaLlmCredential.mockReset().mockResolvedValue(null);
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("OPENROUTER_API_TOKEN", "");
  });
  afterEach(() => vi.unstubAllEnvs());

  function pushRows(lastAi: unknown[], lastHuman: unknown[], pending: unknown[], history: unknown[]) {
    rowQueue.push(lastAi, lastHuman, pending, history);
  }

  it("nada pendiente (sin entrantes tras el corte) → null: no se despacha", async () => {
    pushRows([], [], [], []);
    const result = await buildNeaTurnSnapshot(BASE_INPUT);
    expect(result).toBeNull();
    // ni siquiera se molesta en construir context/profile/offers/llm.
    expect(buildBotContext).not.toHaveBeenCalled();
  });

  it("rol: entrante → lead, saliente ai → agent, manual → owner, operador/plantilla → team", async () => {
    const lead = INBOUND({ id: "m1", createdAt: new Date("2026-09-25T12:00:00.000Z") });
    const agent = OUTBOUND({ id: "m2", origin: "ai", createdAt: new Date("2026-09-25T12:01:00.000Z") });
    const owner = OUTBOUND({ id: "m3", origin: "manual", createdAt: new Date("2026-09-25T12:02:00.000Z") });
    const teamOperator = OUTBOUND({ id: "m4", origin: "operator", createdAt: new Date("2026-09-25T12:03:00.000Z") });
    const teamTemplate = OUTBOUND({ id: "m5", origin: "template", createdAt: new Date("2026-09-25T12:04:00.000Z") });

    const joined = (m: Record<string, unknown>) => ({ message: m, media: null });
    pushRows(
      [],
      [],
      [joined(lead)], // pendiente: el único entrante
      [joined(lead), joined(agent), joined(owner), joined(teamOperator), joined(teamTemplate)]
    );

    const result = await buildNeaTurnSnapshot(BASE_INPUT);
    expect(result).not.toBeNull();
    const roles = Object.fromEntries(result!.payload.history.map((h) => [h.id, h.role]));
    expect(roles).toEqual({
      m1: "lead",
      m2: "agent",
      m3: "owner",
      m4: "team",
      m5: "team",
    });
  });

  it("excluye SOLO un saliente `failed`; un entrante nunca se excluye por status (ni siquiera `pending`)", async () => {
    const entrantePendiente = INBOUND({ id: "m1", status: "pending", createdAt: new Date("2026-09-25T12:00:00.000Z") });
    const salienteOk = OUTBOUND({ id: "m3", status: "pending", createdAt: new Date("2026-09-25T12:02:00.000Z") });

    const joined = (m: Record<string, unknown>) => ({ message: m, media: null });
    // El query real YA filtra el saliente `failed` (m2) en el WHERE; el mock
    // simula directamente lo que la BD devolvería — nunca llega hasta aquí.
    pushRows([], [], [joined(entrantePendiente)], [joined(entrantePendiente), joined(salienteOk)]);

    const result = await buildNeaTurnSnapshot(BASE_INPUT);
    const ids = result!.payload.history.map((h) => h.id);
    expect(ids).toEqual(["m1", "m3"]);
    expect(ids).not.toContain("m2");
  });

  it("el historial se corta en memory_reset_at (no ve nada de antes)", async () => {
    const resetAt = new Date("2026-09-25T12:00:00.000Z");
    const nueva = INBOUND({ id: "m_nueva", createdAt: new Date("2026-09-25T12:30:00.000Z") });
    const joined = (m: Record<string, unknown>) => ({ message: m, media: null });

    // El query real filtra `createdAt > since` en el WHERE — un mensaje
    // anterior al reset ("m_vieja") nunca llegaría hasta aquí; se simula
    // directamente el resultado (solo lo posterior al reset).
    pushRows([], [], [joined(nueva)], [joined(nueva)]);

    const result = await buildNeaTurnSnapshot({ ...BASE_INPUT, memoryResetAt: resetAt });
    const ids = result!.payload.history.map((h) => h.id);
    expect(ids).toEqual(["m_nueva"]);
    expect(ids).not.toContain("m_vieja");
  });

  it("todo pendiente viaja en `history` aunque caiga fuera de los últimos 20", async () => {
    const pendienteViejo = INBOUND({ id: "m_pendiente", createdAt: new Date("2026-09-25T09:00:00.000Z") });
    const recienteA = INBOUND({ id: "m_a", createdAt: new Date("2026-09-25T12:00:00.000Z") });
    const joined = (m: Record<string, unknown>) => ({ message: m, media: null });

    // El pendiente NO aparece en la cola de "últimos 20" (simulando que quedó
    // fuera de esa ventana), pero SÍ en la de pendientes.
    pushRows([], [], [joined(pendienteViejo)], [joined(recienteA)]);

    const result = await buildNeaTurnSnapshot(BASE_INPUT);
    const byId = new Map(result!.payload.history.map((h) => [h.id, h]));
    expect(byId.has("m_pendiente")).toBe(true);
    expect(byId.get("m_pendiente")?.pending).toBe(true);
    expect(byId.get("m_a")?.pending).toBe(false);
  });

  it("acota el conjunto pendiente a como máximo 10 (lo que ya recorta el LIMIT del query)", async () => {
    const joined = (m: Record<string, unknown>) => ({ message: m, media: null });
    const pendientes = Array.from({ length: 10 }, (_, i) =>
      joined(INBOUND({ id: `m${i}`, createdAt: new Date(Date.parse("2026-09-25T12:00:00.000Z") + i * 1000) }))
    );
    pushRows([], [], pendientes, pendientes);

    const result = await buildNeaTurnSnapshot(BASE_INPUT);
    expect(result!.payload.history.filter((h) => h.pending)).toHaveLength(10);
  });

  it("media: mediaId/mime/fileName/caption/transcript para un adjunto real; location/contacts para esos tipos", async () => {
    const conAdjunto = INBOUND({
      id: "m_media",
      type: "audio",
      transcript: "hola desde el audio",
      createdAt: new Date("2026-09-25T12:00:00.000Z"),
    });
    const media = {
      waMediaId: "wa_media_1",
      mimeType: "audio/ogg",
      fileName: "nota.ogg",
      caption: null,
      kind: "audio",
      payload: null,
    };
    pushRows([], [], [{ message: conAdjunto, media }], [{ message: conAdjunto, media }]);

    const result = await buildNeaTurnSnapshot(BASE_INPUT);
    expect(result!.payload.history[0]!.media).toEqual({
      mediaId: "wa_media_1",
      mime: "audio/ogg",
      fileName: "nota.ogg",
      caption: null,
      transcript: "hola desde el audio",
      location: null,
      contacts: null,
    });
  });

  it("texto y transcripción se truncan a 2000/4000 caracteres", async () => {
    const largo = INBOUND({ id: "m_largo", type: "audio", text: "x".repeat(2500), transcript: "y".repeat(5000) });
    const media = { waMediaId: "w1", mimeType: "audio/ogg", fileName: null, caption: null, kind: "audio", payload: null };
    pushRows([], [], [{ message: largo, media }], [{ message: largo, media }]);

    const result = await buildNeaTurnSnapshot(BASE_INPUT);
    const item = result!.payload.history[0]!;
    expect(item.text).toHaveLength(2000);
    expect(item.media?.transcript).toHaveLength(4000);
  });

  it("llm: null sin clave propia de la organización — nunca manda la de plataforma", async () => {
    vi.stubEnv("OPENAI_API_KEY", "clave-de-plataforma-secreta");
    vi.stubEnv("OPENROUTER_API_TOKEN", "otra-clave-de-plataforma");
    getNeaLlmCredential.mockResolvedValue(null); // la org no tiene propia
    pushRows([], [], [{ message: INBOUND(), media: null }], [{ message: INBOUND(), media: null }]);

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
      updatedAt: new Date("2026-09-20T00:00:00.000Z"),
    });
    pushRows([], [], [{ message: INBOUND(), media: null }], [{ message: INBOUND(), media: null }]);

    const result = await buildNeaTurnSnapshot(BASE_INPUT);
    expect(result!.payload.llm).toEqual({
      provider: "openrouter",
      model: "z-ai/glm-5.3-flash",
      apiKey: "sk-org-propia",
    });
    expect(result!.orgCredential).toEqual({ provider: "openrouter", updatedAt: new Date("2026-09-20T00:00:00.000Z") });
  });

  it("offers: solo las futuras (startUtc > now)", async () => {
    const now = Date.now();
    getOffers.mockResolvedValue([
      { startUtc: new Date(now - 60_000).toISOString(), label: "ya pasó" },
      { startUtc: new Date(now + 60_000).toISOString(), label: "futura" },
    ]);
    pushRows([], [], [{ message: INBOUND(), media: null }], [{ message: INBOUND(), media: null }]);

    const result = await buildNeaTurnSnapshot(BASE_INPUT);
    expect(result!.payload.offers).toEqual([{ startUtc: expect.any(String), label: "futura" }]);
  });

  it("dispatchId y attempt viajan tal cual en el payload", async () => {
    pushRows([], [], [{ message: INBOUND(), media: null }], [{ message: INBOUND(), media: null }]);
    const result = await buildNeaTurnSnapshot({ ...BASE_INPUT, dispatchId: "dsp_xyz", attempt: 2 });
    expect(result!.payload.dispatchId).toBe("dsp_xyz");
    expect(result!.payload.attempt).toBe(2);
    expect(result!.payload.version).toBe(2);
  });

  it("context y profile son EXACTAMENTE lo que devuelven buildBotContext/buildBotProfile", async () => {
    pushRows([], [], [{ message: INBOUND(), media: null }], [{ message: INBOUND(), media: null }]);
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
    pushRows([], [], [{ message: INBOUND(), media: null }], [{ message: INBOUND(), media: null }]);
    const result = await buildNeaTurnSnapshot({ ...BASE_INPUT, v1Messages, isTest: true });
    expect(result!.payload.messages).toEqual([
      { id: "wamid.9", type: "text", text: "hola v1", mediaId: null, timestamp: "2026-09-25T12:00:00.000Z" },
    ]);
    expect(result!.payload.isTest).toBe(true);
    expect(result!.payload.contact).toEqual({ identity: "5215512345678", name: "Ana" });
  });
});

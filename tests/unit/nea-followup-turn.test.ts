import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Seguimiento automático (dispatch v2, `followup: true`): un job `ajfu_<conv>`
 * se enruta a `runNeaFollowupTurn`, despacha el historial sin pendientes,
 * jamás avanza el cursor, jamás lanza (un empujón que falla no pausa el chat)
 * y, si el lead escribió mientras el job esperaba, devuelve `leftover:true`
 * para que el worker reprograme el turno normal de ese entrante.
 */

const { dispatchToNea, buildNeaTurnSnapshot, canAutomate } = vi.hoisted(() => ({
  dispatchToNea: vi.fn(),
  buildNeaTurnSnapshot: vi.fn(),
  canAutomate: vi.fn(async () => true),
}));
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
const updates: { table: unknown; values: Record<string, unknown> }[] = [];

function chain(rows: unknown[]) {
  const c: Record<string, unknown> = {};
  for (const m of ["from", "where", "orderBy", "leftJoin"]) c[m] = () => c;
  c.limit = () => Promise.resolve(rows);
  return c;
}
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
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => {
        updates.push({ table, values });
        return updateChain();
      },
    }),
  }),
  schema: new Proxy(
    {},
    { get: (_t, tableName) => new Proxy({}, { get: (_t2, col) => `${String(tableName)}.${String(col)}` }) }
  ),
}));

import { runAgentTurn } from "@/server/ai/pipeline";
import { followupJobId, isFollowupJobId } from "@/server/ai/followup";

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
const JOB = followupJobId("cv_1");

function snapshot() {
  return {
    payload: {
      organizationId: "org_1",
      conversationId: "cv_1",
      isTest: false,
      contact: { identity: "5215512345678", name: "Ana" },
      messages: [],
      version: 2 as const,
      dispatchId: JOB,
      attempt: 0,
      context: {},
      profile: {},
      history: [],
      offers: [],
      llm: null,
      followup: true,
    },
    pendingIds: [],
    orgCredential: null,
  };
}

/** Gates (conversación, perfil), contacto y quién habló último. */
function pushTurn(lastSpeaker: "in" | "out", conv: Record<string, unknown> = CONVERSATION) {
  selectQueue.push([conv], [PROFILE], [CONTACT], [{ direction: lastSpeaker }]);
}

const touchedCursor = () => updates.some((u) => "agentCursorAt" in u.values);
const handedOff = () => updates.some((u) => "handoffAt" in u.values);

describe("seguimiento automático — ids de job", () => {
  it("el id es determinista por conversación y se reconoce", () => {
    expect(followupJobId("cv_abc")).toBe("ajfu_cv_abc");
    expect(isFollowupJobId("ajfu_cv_abc")).toBe(true);
    expect(isFollowupJobId("aj_123")).toBe(false);
    expect(isFollowupJobId("dsp_123")).toBe(false);
  });
});

describe("runNeaFollowupTurn (vía runAgentTurn con un job ajfu_)", () => {
  beforeEach(() => {
    selectQueue.length = 0;
    updates.length = 0;
    dispatchToNea.mockReset();
    buildNeaTurnSnapshot.mockReset().mockResolvedValue(snapshot());
    canAutomate.mockReset().mockResolvedValue(true);
    vi.stubEnv("ALLOK_SAAS_MODE", "");
    vi.stubEnv("BOT_API_KEY", "clave-compartida-con-nea-larga");
    vi.stubEnv("NEA_DISPATCH_URL", "http://nea-agent:8000/dispatch");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("despacha en modo seguimiento: followup:true, sin v1Messages, dispatchId = id del job, sin tocar el cursor", async () => {
    pushTurn("out");
    dispatchToNea.mockResolvedValue({ kind: "ok", body: { ok: true, action: "replied" } });

    const result = await runAgentTurn("cv_1", JOB);

    expect(result).toEqual({ leftover: false });
    expect(buildNeaTurnSnapshot).toHaveBeenCalledTimes(1);
    expect(buildNeaTurnSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ followup: true, v1Messages: [], dispatchId: JOB, attempt: 0, isTest: false })
    );
    expect(dispatchToNea).toHaveBeenCalledTimes(1);
    expect(touchedCursor()).toBe(false);
  });

  it("si el lead escribió después del agente → no despacha y devuelve leftover:true (el worker reprograma su turno)", async () => {
    pushTurn("in");

    const result = await runAgentTurn("cv_1", JOB);

    expect(result).toEqual({ leftover: true });
    expect(buildNeaTurnSnapshot).not.toHaveBeenCalled();
    expect(dispatchToNea).not.toHaveBeenCalled();
  });

  it("IA apagada → no despacha, aunque el perfil tenga activación por mensajes; leftover:true por si el lead escribió", async () => {
    selectQueue.push([{ ...CONVERSATION, aiEnabled: false }], [{ ...PROFILE, activationEnabled: true }]);

    const result = await runAgentTurn("cv_1", JOB);

    expect(result).toEqual({ leftover: true });
    expect(dispatchToNea).not.toHaveBeenCalled();
  });

  it("chat en handoff → nada", async () => {
    selectQueue.push([{ ...CONVERSATION, handoffAt: new Date() }], [{ ...PROFILE, activationEnabled: true }]);

    await runAgentTurn("cv_1", JOB);

    expect(dispatchToNea).not.toHaveBeenCalled();
  });

  it("un 4xx de Nea no lanza ni pausa el chat", async () => {
    pushTurn("out");
    dispatchToNea.mockResolvedValue({ kind: "client_error", status: 400, message: "Nea devolvió 400" });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(runAgentTurn("cv_1", JOB)).resolves.toEqual({ leftover: false });
    expect(dispatchToNea).toHaveBeenCalledTimes(1);
    expect(handedOff()).toBe(false);
    log.mockRestore();
  });

  it("5xx en los 3 intentos → no lanza, no pausa, no toca el cursor", async () => {
    vi.useFakeTimers();
    pushTurn("out");
    selectQueue.push([], []); // neaReplyExists de los intentos 1 y 2: la respuesta no llegó
    dispatchToNea.mockResolvedValue({ kind: "retryable", status: 502, message: "Nea devolvió 502" });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    const turn = runAgentTurn("cv_1", JOB);
    await vi.advanceTimersByTimeAsync(2_000);
    await vi.advanceTimersByTimeAsync(5_000);

    await expect(turn).resolves.toEqual({ leftover: false });
    expect(dispatchToNea).toHaveBeenCalledTimes(3);
    expect(handedOff()).toBe(false);
    expect(touchedCursor()).toBe(false);
    log.mockRestore();
  });

  it("en un reintento, si la respuesta ya aterrizó (id determinista con wamid) → deja de insistir", async () => {
    vi.useFakeTimers();
    pushTurn("out");
    selectQueue.push([{ waMessageId: "wamid.ya", status: "sent" }]);
    dispatchToNea.mockResolvedValueOnce({ kind: "retryable", status: null, message: "timeout" });

    const turn = runAgentTurn("cv_1", JOB);
    await vi.advanceTimersByTimeAsync(2_000);

    await expect(turn).resolves.toEqual({ leftover: false });
    expect(dispatchToNea).toHaveBeenCalledTimes(1);
  });

  it("un error inesperado armando el snapshot no lanza (el worker lo convertiría en handoff)", async () => {
    pushTurn("out");
    buildNeaTurnSnapshot.mockRejectedValue(new Error("se cayó la base"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(runAgentTurn("cv_1", JOB)).resolves.toEqual({ leftover: true });
    expect(dispatchToNea).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it("sin Nea (NEA_DISPATCH_URL ausente) un job de seguimiento jamás cae al turno de Rei", async () => {
    vi.stubEnv("NEA_DISPATCH_URL", "");

    await expect(runAgentTurn("cv_1", JOB)).resolves.toEqual({ leftover: true });
    expect(selectQueue.length).toBe(0);
    expect(dispatchToNea).not.toHaveBeenCalled();
  });

  it("un job normal sigue por el turno de siempre (sin followup)", async () => {
    selectQueue.push([CONVERSATION], [PROFILE], [CONTACT], []);
    buildNeaTurnSnapshot.mockResolvedValue(null); // nada pendiente: no despacha

    await runAgentTurn("cv_1", "aj_normal");

    expect(buildNeaTurnSnapshot).toHaveBeenCalledWith(expect.not.objectContaining({ followup: true }));
    expect(dispatchToNea).not.toHaveBeenCalled();
  });
});

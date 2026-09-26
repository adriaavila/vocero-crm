import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PENDING_LIMIT } from "@/server/ai/nea-payload";

/**
 * El loop de reintentos de `runNeaAgentTurn` (dispatch v2, Nea sin estado):
 * el snapshot se reconstruye ENTERO en cada intento, el `dispatchId` es
 * estable durante todo el turno, un reintento detecta si la respuesta ya
 * había llegado (id determinista) para no volver a POSTear, el cursor
 * avanza con GREATEST tras un 2xx, un 4xx no reintenta, y el eco de la
 * respuesta (`llm`/`handoff`) se aplica.
 */

const { dispatchToNea, buildNeaTurnSnapshot, markAiCredentialInvalidIfUnchanged, canAutomate, inArraySpy } =
  vi.hoisted(() => ({
    dispatchToNea: vi.fn(),
    buildNeaTurnSnapshot: vi.fn(),
    markAiCredentialInvalidIfUnchanged: vi.fn(async () => {}),
    canAutomate: vi.fn(async () => true),
    // fix-27b item 1: `advanceCursor` embebe `inArray(id, pendingIds)` dentro
    // de una subconsulta opaca — el objeto SQL compilado no expone los
    // valores atados por JSON.stringify. Espiar la llamada real es la única
    // forma de verificar CUÁLES ids se usaron para avanzar el cursor.
    inArraySpy: vi.fn(),
  }));
vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    inArray: (...args: Parameters<typeof actual.inArray>) => {
      inArraySpy(...args);
      return actual.inArray(...args);
    },
  };
});
vi.mock("@/server/ai/nea-dispatch", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/ai/nea-dispatch")>();
  return { ...actual, dispatchToNea };
});
vi.mock("@/server/ai/nea-payload", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/ai/nea-payload")>();
  return { ...actual, buildNeaTurnSnapshot };
});
vi.mock("@/server/ai/credentials", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/ai/credentials")>();
  return { ...actual, markAiCredentialInvalidIfUnchanged };
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

function snapshotWith(overrides: Record<string, unknown> = {}) {
  return {
    payload: {
      organizationId: "org_1",
      conversationId: "cv_1",
      isTest: false,
      contact: { identity: "5215512345678", name: "Ana" },
      messages: [],
      version: 2 as const,
      dispatchId: "dsp_should_be_overridden",
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

/** Empuja las 3 filas de los gates (conversación, perfil, contacto), una sola vez por turno. */
function pushGates(conv: Record<string, unknown> = CONVERSATION) {
  selectQueue.push([conv], [PROFILE], [CONTACT]);
}
/**
 * Empuja las 2 filas que `loadNeaGateState` relee en CADA intento posterior
 * al primero (conversación, perfil) — antes de `pushAttempt` de ese intento.
 */
function pushGateReread(conv: Record<string, unknown> = CONVERSATION) {
  selectQueue.push([conv], [PROFILE]);
}
/** Empuja lo que consume UN intento del loop: el v1Messages y, si aplica, el replyLanded. */
function pushAttempt(v1Rows: unknown[] = [INBOUND_MESSAGE], replyLandedRows?: unknown[]) {
  selectQueue.push(v1Rows);
  if (replyLandedRows !== undefined) selectQueue.push(replyLandedRows);
}

describe("runNeaAgentTurn — loop de reintentos (dispatch v2)", () => {
  beforeEach(() => {
    selectQueue.length = 0;
    updates.length = 0;
    dispatchToNea.mockReset();
    buildNeaTurnSnapshot.mockReset().mockResolvedValue(snapshotWith());
    markAiCredentialInvalidIfUnchanged.mockReset().mockResolvedValue(undefined);
    canAutomate.mockReset().mockResolvedValue(true);
    inArraySpy.mockClear();
    vi.stubEnv("ALLOK_SAAS_MODE", "");
    vi.stubEnv("BOT_API_KEY", "clave-compartida-con-nea-larga");
    vi.stubEnv("NEA_DISPATCH_URL", "http://nea-agent:8000/dispatch");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("un dispatchId provisto (worker de SaaS) se manda EXACTO a buildNeaTurnSnapshot, con attempt:0 en el único intento exitoso", async () => {
    pushGates();
    pushAttempt();
    dispatchToNea.mockResolvedValue({ kind: "ok", body: { ok: true, action: "noop" } });

    await runAgentTurn("cv_1", "aj_job_123");

    expect(buildNeaTurnSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ dispatchId: "aj_job_123", attempt: 0 })
    );
  });

  it("sin dispatchId (debounce/Laboratorio) genera uno `dsp_…` y lo REUSA en todos los intentos del mismo turno", async () => {
    vi.useFakeTimers();
    pushGates();
    pushAttempt(); // intento 0
    pushGateReread();
    pushAttempt([], []); // intento 1: v1Messages + replyLanded (sin id existente)
    pushGateReread();
    pushAttempt([], []); // intento 2: v1Messages + replyLanded
    dispatchToNea.mockResolvedValue({ kind: "retryable", status: 500, message: "Nea devolvió 500" });

    const turn = runAgentTurn("cv_1").catch(() => {});
    await vi.advanceTimersByTimeAsync(2_000);
    await vi.advanceTimersByTimeAsync(5_000);
    await turn;

    const ids = buildNeaTurnSnapshot.mock.calls.map((c) => (c[0] as { dispatchId: string }).dispatchId);
    expect(new Set(ids).size).toBe(1); // el MISMO dispatchId en los 3 intentos
    expect(ids[0]).toMatch(/^dsp_/);
    const attempts = buildNeaTurnSnapshot.mock.calls.map((c) => (c[0] as { attempt: number }).attempt);
    expect(attempts).toEqual([0, 1, 2]);
  });

  it("el snapshot se reconstruye ENTERO en cada intento — nunca se reusa el de la vuelta anterior", async () => {
    vi.useFakeTimers();
    pushGates();
    pushAttempt([{ ...INBOUND_MESSAGE, id: "msg_intento_0" }]);
    pushGateReread();
    pushAttempt([{ ...INBOUND_MESSAGE, id: "msg_intento_1" }], []);
    dispatchToNea
      .mockResolvedValueOnce({ kind: "retryable", status: 500, message: "Nea devolvió 500" })
      .mockResolvedValueOnce({ kind: "ok", body: { ok: true, action: "noop" } });

    const turn = runAgentTurn("cv_1", "aj_1");
    await vi.advanceTimersByTimeAsync(2_000);
    await turn;

    expect(buildNeaTurnSnapshot).toHaveBeenCalledTimes(2);
    const v1 = buildNeaTurnSnapshot.mock.calls.map(
      (c) => (c[0] as { v1Messages: { id: string }[] }).v1Messages[0]?.id
    );
    expect(v1).toEqual(["msg_intento_0", "msg_intento_1"]);
  });

  it("en un reintento, si el id determinista de la respuesta YA existe → avanza el cursor y NO vuelve a POSTear", async () => {
    vi.useFakeTimers();
    pushGates();
    pushAttempt(); // intento 0: falla (retryable)
    pushGateReread();
    // intento 1: replyLanded ENCUENTRA la fila, YA con wamid (entregada de verdad).
    pushAttempt([INBOUND_MESSAGE], [{ waMessageId: "wamid.ya_existe", status: "sent" }]);
    dispatchToNea.mockResolvedValueOnce({ kind: "retryable", status: 500, message: "Nea devolvió 500" });

    const turn = runAgentTurn("cv_1", "aj_1");
    await vi.advanceTimersByTimeAsync(2_000);
    await turn;

    expect(dispatchToNea).toHaveBeenCalledTimes(1); // NO hubo un segundo POST
    const cursorUpdate = updates.find((u) => "agentCursorAt" in u.values);
    expect(cursorUpdate).toBeDefined(); // el cursor SÍ avanzó
  });

  it("fix-27b item 1: en un reintento, la respuesta determinista YA EXISTE (con o sin wamid) → se rinde sin volver a POSTear y avanza el cursor SOLO hasta lo que el PRIMER intento posteó", async () => {
    vi.useFakeTimers();
    pushGates();
    // intento 0: solo A pendiente — falla (retryable), pero Nea alcanzó a
    // reservar la respuesta por su cuenta (sigue sin wamid: puede seguir en
    // vuelo, no importa — lo único que cuenta es que la fila YA EXISTE).
    buildNeaTurnSnapshot.mockResolvedValueOnce({ ...snapshotWith(), pendingIds: ["msg_a"] });
    dispatchToNea.mockResolvedValueOnce({ kind: "retryable", status: 500, message: "Nea devolvió 500" });
    pushAttempt();

    pushGateReread();
    // intento 1: el snapshot FRESCO ya trae A y B — pero `neaReplyExists`
    // encuentra la fila (regla conservadora, fix-27b): se rinde AQUÍ, sin
    // llegar a despachar este intento.
    buildNeaTurnSnapshot.mockResolvedValueOnce({ ...snapshotWith(), pendingIds: ["msg_a", "msg_b"] });
    pushAttempt([INBOUND_MESSAGE], [{ waMessageId: "wamid.seq0", status: "sent" }]);

    const turn = runAgentTurn("cv_1", "aj_1");
    await vi.advanceTimersByTimeAsync(2_000);
    await turn;

    expect(dispatchToNea).toHaveBeenCalledTimes(1); // NUNCA se posteó el intento 1
    const cursorUpdate = updates.find((u) => "agentCursorAt" in u.values);
    expect(cursorUpdate).toBeDefined();
    // avanza SOLO hasta lo que el intento 0 (el PRIMERO posteado) mandó —
    // nunca hasta el pendiente fresco completo del intento 1.
    expect(inArraySpy).toHaveBeenCalledTimes(1);
    expect(inArraySpy).toHaveBeenCalledWith(expect.anything(), ["msg_a"]);
  });

  it("fix-27b item 1 (tres intentos): un eco de la respuesta del intento 0 llega recién en el intento 2 → avanza hasta lo del intento 0 (firstPostedPendingIds), NUNCA hasta lo del intento 1 (que ya no se recuerda)", async () => {
    vi.useFakeTimers();
    pushGates();
    // intento 0: {A} — falla.
    buildNeaTurnSnapshot.mockResolvedValueOnce({ ...snapshotWith(), pendingIds: ["msg_a"] });
    dispatchToNea.mockResolvedValueOnce({ kind: "retryable", status: 500, message: "500" });
    pushAttempt();

    // intento 1: {A,B} — la respuesta de Nea sigue sin aparecer (todavía en
    // vuelo desde el intento 0) → NO existe la fila → se despacha de nuevo,
    // y TAMBIÉN falla.
    pushGateReread();
    buildNeaTurnSnapshot.mockResolvedValueOnce({ ...snapshotWith(), pendingIds: ["msg_a", "msg_b"] });
    pushAttempt([INBOUND_MESSAGE], []); // neaReplyExists: fila vacía → no existe
    dispatchToNea.mockResolvedValueOnce({ kind: "retryable", status: 502, message: "502" });

    // intento 2: {A,B,C} — AHORA sí existe la fila (la respuesta lenta del
    // intento 0 por fin aterrizó) → se rinde. Si se usara `lastPosted`
    // (lo último posteado, intento 1: {A,B}) en vez de `firstPosted`
    // (intento 0: {A}), B se marcaría contestado sin haberlo estado nunca.
    pushGateReread();
    buildNeaTurnSnapshot.mockResolvedValueOnce({ ...snapshotWith(), pendingIds: ["msg_a", "msg_b", "msg_c"] });
    pushAttempt([INBOUND_MESSAGE], [{ waMessageId: "wamid.seq0", status: "sent" }]);

    const turn = runAgentTurn("cv_1", "aj_1");
    await vi.advanceTimersByTimeAsync(2_000);
    await vi.advanceTimersByTimeAsync(5_000);
    await turn;

    expect(dispatchToNea).toHaveBeenCalledTimes(2); // intento 2 NUNCA se posteó
    expect(inArraySpy).toHaveBeenCalledTimes(1);
    expect(inArraySpy).toHaveBeenCalledWith(expect.anything(), ["msg_a"]); // SOLO lo del intento 0
  });

  it("fix-27b item 1: la fila NO existe (respuesta genuinamente fresca en el intento 1) → SÍ despacha y avanza el cursor con TODO el pendiente de ese intento", async () => {
    vi.useFakeTimers();
    pushGates();
    buildNeaTurnSnapshot.mockResolvedValueOnce({ ...snapshotWith(), pendingIds: ["msg_a"] });
    dispatchToNea.mockResolvedValueOnce({ kind: "retryable", status: 500, message: "500" });
    pushAttempt();

    pushGateReread();
    buildNeaTurnSnapshot.mockResolvedValueOnce({ ...snapshotWith(), pendingIds: ["msg_a", "msg_b"] });
    pushAttempt([INBOUND_MESSAGE], []); // neaReplyExists PRE-POST: no existe ninguna fila todavía
    dispatchToNea.mockResolvedValueOnce({ kind: "ok", body: { ok: true, action: "replied" } });
    selectQueue.push([]); // neaReplyExists RE-CHEQUEO tras el 2xx: tampoco encuentra nada — de verdad fresca

    const turn = runAgentTurn("cv_1", "aj_1");
    await vi.advanceTimersByTimeAsync(2_000);
    await turn;

    expect(dispatchToNea).toHaveBeenCalledTimes(2); // el intento 1 SÍ se posteó
    expect(inArraySpy).toHaveBeenCalledTimes(1);
    // avance COMPLETO: {A,B} — es una respuesta de verdad fresca, no un eco.
    expect(inArraySpy).toHaveBeenCalledWith(expect.anything(), ["msg_a", "msg_b"]);
  });

  it("fix-27b item 3: el chequeo PREVIO al POST no encuentra nada, pero el 2xx que vuelve es un eco (la carrera terminó DURANTE este POST) → el re-chequeo lo detecta y avanza SOLO hasta lo del intento 0", async () => {
    vi.useFakeTimers();
    pushGates();
    buildNeaTurnSnapshot.mockResolvedValueOnce({ ...snapshotWith(), pendingIds: ["msg_a"] });
    dispatchToNea.mockResolvedValueOnce({ kind: "retryable", status: 500, message: "500" });
    pushAttempt();

    pushGateReread();
    buildNeaTurnSnapshot.mockResolvedValueOnce({ ...snapshotWith(), pendingIds: ["msg_a", "msg_b"] });
    pushAttempt([INBOUND_MESSAGE], []); // PRE-POST: todavía no existía nada — se decide despachar
    // Durante la espera del POST, el intento 0 por fin aterriza — Nea choca
    // con esa reserva y contesta 2xx sin haber armado nada para B.
    dispatchToNea.mockResolvedValueOnce({ kind: "ok", body: { ok: true, action: "replied" } });
    selectQueue.push([{ waMessageId: "wamid.seq0", status: "sent" }]); // RE-CHEQUEO: SÍ aterrizó

    const turn = runAgentTurn("cv_1", "aj_1");
    await vi.advanceTimersByTimeAsync(2_000);
    await turn;

    expect(dispatchToNea).toHaveBeenCalledTimes(2); // el intento 1 SÍ se posteó (el pre-chequeo no lo evitó)
    expect(inArraySpy).toHaveBeenCalledTimes(1);
    // pero el avance queda LIMITADO a lo del intento 0 — B nunca se le mandó de verdad.
    expect(inArraySpy).toHaveBeenCalledWith(expect.anything(), ["msg_a"]);
  });

  it("nada pendiente (buildNeaTurnSnapshot → null) → no despacha, sin importar el intento", async () => {
    buildNeaTurnSnapshot.mockResolvedValue(null);
    pushGates();
    pushAttempt();

    await runAgentTurn("cv_1");

    expect(dispatchToNea).not.toHaveBeenCalled();
  });

  it("2xx → agent_cursor_at se actualiza con GREATEST(cursor actual, lo pendiente despachado)", async () => {
    pushGates();
    pushAttempt();
    dispatchToNea.mockResolvedValue({ kind: "ok", body: { ok: true, action: "noop" } });

    await runAgentTurn("cv_1");

    const cursorUpdate = updates.find((u) => "agentCursorAt" in u.values);
    expect(cursorUpdate).toBeDefined();
    // El valor es un fragmento SQL con GREATEST/COALESCE — se verifica por texto,
    // no por igualdad estructural (drizzle lo compila a parámetros).
    const sqlText = JSON.stringify(cursorUpdate!.values.agentCursorAt);
    expect(sqlText.toLowerCase()).toContain("greatest");
    expect(sqlText.toLowerCase()).toContain("coalesce");
  });

  it("fix-27b item 2: el pendiente se cortó en el límite (10) → leftover:true, aunque el intento haya sido 2xx en el primero", async () => {
    buildNeaTurnSnapshot.mockResolvedValueOnce({
      ...snapshotWith(),
      pendingIds: Array.from({ length: PENDING_LIMIT }, (_, i) => `msg_${i}`),
    });
    dispatchToNea.mockResolvedValue({ kind: "ok", body: { ok: true, action: "noop" } });
    pushGates();
    pushAttempt();

    const result = await runAgentTurn("cv_1");

    expect(result).toEqual({ leftover: true });
  });

  it("un pendiente por debajo del límite y sin reintentos → leftover:false", async () => {
    buildNeaTurnSnapshot.mockResolvedValueOnce({ ...snapshotWith(), pendingIds: ["msg_a"] });
    dispatchToNea.mockResolvedValue({ kind: "ok", body: { ok: true, action: "noop" } });
    pushGates();
    pushAttempt();

    const result = await runAgentTurn("cv_1");

    expect(result).toEqual({ leftover: false });
  });

  it("4xx → falla en el PRIMER intento, sin reintentar (propaga para que needs_review/handoff lo agarren)", async () => {
    pushGates();
    pushAttempt();
    dispatchToNea.mockResolvedValue({ kind: "client_error", status: 422, message: "Nea devolvió 422" });

    await expect(runAgentTurn("cv_1")).rejects.toThrow(/422/);
    expect(dispatchToNea).toHaveBeenCalledTimes(1);
  });

  it("agota los 3 intentos ante 5xx persistente y termina lanzando (~2s, ~5s entre intentos)", async () => {
    vi.useFakeTimers();
    pushGates();
    pushAttempt();
    pushGateReread();
    pushAttempt([], []);
    pushGateReread();
    pushAttempt([], []);
    dispatchToNea.mockResolvedValue({ kind: "retryable", status: 500, message: "Nea devolvió 500" });

    const turn = runAgentTurn("cv_1");
    const assertion = expect(turn).rejects.toThrow(/500/);
    await vi.advanceTimersByTimeAsync(2_000);
    await vi.advanceTimersByTimeAsync(5_000);
    await assertion;

    expect(dispatchToNea).toHaveBeenCalledTimes(3);
  });

  it("Laboratorio: UN solo intento — nunca reintenta aunque el despacho falle", async () => {
    pushGates({ ...CONVERSATION, isTest: true });
    pushAttempt();
    dispatchToNea.mockResolvedValue({ kind: "retryable", status: 500, message: "Nea devolvió 500" });

    await expect(runAgentTurn("cv_1")).rejects.toThrow(/500/);
    expect(dispatchToNea).toHaveBeenCalledTimes(1);
  });

  it("llm.status auth_failed con source:org → marca la clave inválida SOLO si key_iv no cambió", async () => {
    const keyIv = "iv-actual-base64";
    buildNeaTurnSnapshot.mockResolvedValue(
      snapshotWith2({ llm: { provider: "openrouter", model: "m", apiKey: "sk-org" } }, { provider: "openrouter", keyIv })
    );
    dispatchToNea.mockResolvedValue({
      kind: "ok",
      body: { ok: true, action: "replied", llm: { source: "org", status: "auth_failed" } },
    });
    pushGates();
    pushAttempt();

    await runAgentTurn("cv_1");

    expect(markAiCredentialInvalidIfUnchanged).toHaveBeenCalledWith("org_1", "openrouter", keyIv, "auth_failed");
  });

  it("item 11: llm.status no_credits con source:org → marca la razón EXACTA (no_credits, no auth_failed) — la UI distingue la copia", async () => {
    const keyIv = "iv-actual-base64";
    buildNeaTurnSnapshot.mockResolvedValue(
      snapshotWith2({ llm: { provider: "openrouter", model: "m", apiKey: "sk-org" } }, { provider: "openrouter", keyIv })
    );
    dispatchToNea.mockResolvedValue({
      kind: "ok",
      body: { ok: true, action: "replied", llm: { source: "org", status: "no_credits" } },
    });
    pushGates();
    pushAttempt();

    await runAgentTurn("cv_1");

    expect(markAiCredentialInvalidIfUnchanged).toHaveBeenCalledWith("org_1", "openrouter", keyIv, "no_credits");
  });

  it("llm.status ok con source:org → NO marca nada inválido", async () => {
    const keyIv = "iv-actual-base64";
    buildNeaTurnSnapshot.mockResolvedValue(
      snapshotWith2({ llm: { provider: "openrouter", model: "m", apiKey: "sk-org" } }, { provider: "openrouter", keyIv })
    );
    dispatchToNea.mockResolvedValue({
      kind: "ok",
      body: { ok: true, action: "replied", llm: { source: "org", status: "ok" } },
    });
    pushGates();
    pushAttempt();

    await runAgentTurn("cv_1");

    expect(markAiCredentialInvalidIfUnchanged).not.toHaveBeenCalled();
  });

  it("llm.status auth_failed con source:platform → NO marca nada (no era la clave de la org)", async () => {
    dispatchToNea.mockResolvedValue({
      kind: "ok",
      body: { ok: true, action: "replied", llm: { source: "platform", status: "auth_failed" } },
    });
    pushGates();
    pushAttempt();

    await runAgentTurn("cv_1");

    expect(markAiCredentialInvalidIfUnchanged).not.toHaveBeenCalled();
  });

  it("handoff.applied === false → aplica el handoff con el motivo que mandó Nea", async () => {
    dispatchToNea.mockResolvedValue({
      kind: "ok",
      body: { ok: true, action: "replied", handoff: { reason: "hostilidad", applied: false } },
    });
    pushGates();
    pushAttempt();

    await runAgentTurn("cv_1");

    const handoffUpdate = updates.find((u) => u.values.handoffReason === "hostilidad");
    expect(handoffUpdate).toBeDefined();
  });

  it("handoff.applied === true → NO reaplica nada (Nea ya lo hizo)", async () => {
    dispatchToNea.mockResolvedValue({
      kind: "ok",
      body: { ok: true, action: "replied", handoff: { reason: "cliente", applied: true } },
    });
    pushGates();
    pushAttempt();

    await runAgentTurn("cv_1");

    expect(updates.some((u) => "handoffReason" in u.values)).toBe(false);
  });

  it("un motivo de handoff que Nea invente cae a 'modelo' en vez de tirar el turno", async () => {
    dispatchToNea.mockResolvedValue({
      kind: "ok",
      body: { ok: true, action: "replied", handoff: { reason: "porque el señor se enojó", applied: false } },
    });
    pushGates();
    pushAttempt();

    await runAgentTurn("cv_1");

    const handoffUpdate = updates.find((u) => "handoffReason" in u.values);
    expect(handoffUpdate?.values.handoffReason).toBe("modelo");
  });

  it("la apiKey de la organización nunca aparece en un console.error/warn durante un turno que falla", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    buildNeaTurnSnapshot.mockResolvedValue(
      snapshotWith2(
        { llm: { provider: "openrouter", model: "m", apiKey: "sk-super-secreta-no-debe-salir" } },
        { provider: "openrouter", keyIv: "iv-cualquiera" }
      )
    );
    pushGates();
    pushAttempt();
    dispatchToNea.mockResolvedValue({ kind: "client_error", status: 422, message: "Nea devolvió 422" });

    await runAgentTurn("cv_1").catch(() => {});

    const allLoggedText = [...errorSpy.mock.calls, ...warnSpy.mock.calls].flat().map((a) => JSON.stringify(a)).join("\n");
    expect(allLoggedText).not.toContain("sk-super-secreta-no-debe-salir");
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });
});

/** Variante de `snapshotWith` que también permite fijar `orgCredential`. */
function snapshotWith2(
  payloadOverrides: Record<string, unknown>,
  orgCredential: { provider: "openai" | "openrouter"; keyIv: string } | null
) {
  const s = snapshotWith(payloadOverrides);
  return { ...s, orgCredential };
}

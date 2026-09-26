import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Fix-27b: la contabilidad del worker, tras un turno, reprogramaba solo si
 * llegó un entrante MÁS NUEVO que `claimedAt` (cuándo arrancó el turno). Pero
 * el turno mismo puede terminar SIN cubrir todo hasta `claimedAt` — la regla
 * conservadora de la carrera de reintentos (item 1) o el límite de 10
 * pendientes por despacho (item 2) pueden dejar el cursor MÁS ATRÁS de
 * `claimedAt` con mensajes de verdad sin contestar entre medio. Comparar
 * contra `agent_cursor_at` (lo que el turno de verdad terminó cubriendo) en
 * vez de `claimedAt` cierra ese hueco: cualquier entrante posterior al
 * cursor real dispara la reprogramación, sea un leftover de más de 10 o uno
 * que el turno tuvo que dejar sin tocar por prudencia.
 */

const { execute, runAgentTurn, scheduleAgentTurn, selectQueue } = vi.hoisted(() => ({
  execute: vi.fn(),
  runAgentTurn: vi.fn(),
  scheduleAgentTurn: vi.fn(),
  selectQueue: [] as unknown[][],
}));

function selectChain(rows: unknown[]) {
  const c: Record<string, unknown> = {};
  for (const m of ["from", "where"]) c[m] = () => c;
  c.limit = () => Promise.resolve(rows);
  return c;
}

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    execute,
    select: () => selectChain(selectQueue.shift() ?? []),
    update: () => ({ set: () => ({ where: () => Promise.resolve([]) }) }),
  }),
  schema: { agentJob: {}, message: {}, conversation: { agentCursorAt: "agentCursorAt", id: "id" } },
}));
vi.mock("@/server/ai/pipeline", () => ({
  applyHandoff: vi.fn(),
  runAgentTurn,
  scheduleAgentTurn,
}));

import { claimUpToCapacity, resetWorkerStateForTests } from "@/server/ai/worker";

describe("worker: reprogramar tras el turno mira agent_cursor_at, no claimedAt (fix-27b)", () => {
  beforeEach(() => {
    execute.mockReset();
    runAgentTurn.mockReset().mockResolvedValue(undefined);
    scheduleAgentTurn.mockReset();
    selectQueue.length = 0;
    let served = false;
    execute.mockImplementation(async () => {
      if (served) return [];
      served = true;
      // `locked_at` = claimedAt = 12:00:00 — el turno arrancó aquí.
      return [{ id: "job_1", conversationId: "conv_1", lockedAt: "2026-09-26T12:00:00.000Z" }];
    });
    resetWorkerStateForTests();
    vi.stubEnv("AGENT_WORKER_CONCURRENCY", "1");
  });

  it("un mensaje llegó ANTES de claimedAt pero DESPUÉS del cursor real (el turno no llegó a cubrirlo) → SÍ reprograma", async () => {
    // agent_cursor_at quedó en 11:59:00 — antes de claimedAt (12:00:00), pero
    // el mensaje de abajo (11:59:30) es más nuevo que ESO, aunque más viejo
    // que claimedAt. La comparación vieja (contra claimedAt) lo hubiera
    // ignorado — la nueva (contra agent_cursor_at) lo encuentra.
    selectQueue.push([{ agentCursorAt: new Date("2026-09-26T11:59:00.000Z") }]);
    selectQueue.push([{ id: "msg_leftover" }]); // freshInbound: SÍ hay algo después del cursor

    await claimUpToCapacity();
    await vi.waitFor(() => expect(scheduleAgentTurn).toHaveBeenCalledWith("conv_1"));
  });

  it("nada después del cursor real → NO reprograma", async () => {
    selectQueue.push([{ agentCursorAt: new Date("2026-09-26T12:00:00.000Z") }]);
    selectQueue.push([]); // freshInbound: nada

    await claimUpToCapacity();
    await vi.waitFor(() => expect(runAgentTurn).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(scheduleAgentTurn).not.toHaveBeenCalled();
  });

  it("conversación sin cursor todavía (agent_cursor_at NULL) → cae a claimedAt, como antes", async () => {
    selectQueue.push([{ agentCursorAt: null }]);
    selectQueue.push([{ id: "msg_tras_claim" }]);

    await claimUpToCapacity();
    await vi.waitFor(() => expect(scheduleAgentTurn).toHaveBeenCalledWith("conv_1"));
  });
});

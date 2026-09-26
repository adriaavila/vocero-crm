import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Fix-27b (segunda ronda de review): la contabilidad del worker, tras un
 * turno, reprograma si llegó un entrante MÁS NUEVO que `claimedAt` (cuándo
 * arrancó el turno) — eso NO cambia (comparar contra `agent_cursor_at` en su
 * lugar se revirtió: esa columna vuelve como `Date` de JS, truncando los
 * microsegundos de `created_at`, así que una conversación YA contestada se
 * reprogramaría sola casi siempre — 999 de cada 1000 veces).
 *
 * Lo que SÍ es nuevo: `runAgentTurn` devuelve `{leftover}` — true cuando el
 * turno mismo NO llegó a cubrir todo lo pendiente (la regla conservadora de
 * la carrera de reintentos, o el límite de 10 pendientes por despacho). El
 * worker reprograma si CUALQUIERA de los dos dice que hace falta —
 * `freshInbound` (algo llegó después de que arrancó el turno) o `leftover`
 * (el turno mismo dejó algo sin cubrir, aunque nada nuevo haya llegado
 * después).
 */

const { execute, runAgentTurn, scheduleAgentTurn, applyHandoff, selectQueue } = vi.hoisted(() => ({
  execute: vi.fn(),
  runAgentTurn: vi.fn(),
  scheduleAgentTurn: vi.fn(),
  applyHandoff: vi.fn(),
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
  applyHandoff,
  runAgentTurn,
  scheduleAgentTurn,
}));

import { claimUpToCapacity, resetWorkerStateForTests } from "@/server/ai/worker";

describe("worker: reprogramar tras el turno — freshInbound (claimedAt) o leftover (fix-27b)", () => {
  beforeEach(() => {
    execute.mockReset();
    runAgentTurn.mockReset();
    scheduleAgentTurn.mockReset();
    applyHandoff.mockReset().mockResolvedValue(undefined);
    selectQueue.length = 0;
    let served = false;
    execute.mockImplementation(async () => {
      if (served) return [];
      served = true;
      return [{ id: "job_1", conversationId: "conv_1", lockedAt: "2026-09-26T12:00:00.000Z" }];
    });
    resetWorkerStateForTests();
    vi.stubEnv("AGENT_WORKER_CONCURRENCY", "1");
  });

  it("una conversación YA CONTESTADA (leftover:false, nada llegó después de claimedAt) → NO reprograma", async () => {
    runAgentTurn.mockResolvedValue({ leftover: false });
    selectQueue.push([]); // freshInbound: nada después de claimedAt

    await claimUpToCapacity();
    await vi.waitFor(() => expect(runAgentTurn).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(scheduleAgentTurn).not.toHaveBeenCalled();
  });

  it("una conversación en HANDOFF (el turno ni corrió, leftover:false) → NO reprograma", async () => {
    // `loadNeaGateState` devolvió null (handoff activo): el turno se rinde
    // de entrada con leftover:false — nunca debe auto-reprogramarse solo
    // porque un humano tomó el control.
    runAgentTurn.mockResolvedValue({ leftover: false });
    selectQueue.push([]); // tampoco hay entrantes frescos

    await claimUpToCapacity();
    await vi.waitFor(() => expect(runAgentTurn).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(scheduleAgentTurn).not.toHaveBeenCalled();
  });

  it("leftover:true (la regla conservadora, o el límite de 10) → SÍ reprograma, aunque no haya entrantes frescos", async () => {
    runAgentTurn.mockResolvedValue({ leftover: true });
    selectQueue.push([]); // nada nuevo llegó — el ÚNICO motivo es leftover

    await claimUpToCapacity();
    await vi.waitFor(() => expect(scheduleAgentTurn).toHaveBeenCalledWith("conv_1"));
  });

  it("freshInbound (algo llegó después de claimedAt) con leftover:false → también reprograma", async () => {
    runAgentTurn.mockResolvedValue({ leftover: false });
    selectQueue.push([{ id: "msg_fresh" }]);

    await claimUpToCapacity();
    await vi.waitFor(() => expect(scheduleAgentTurn).toHaveBeenCalledWith("conv_1"));
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Después de un turno que salió bien, la contabilidad del worker (marcar
 * `done`, revisar si llegaron entrantes nuevos) puede fallar. Eso NUNCA debe
 * pausar la conversación con un handoff "error": el agente ya contestó.
 * (Producción, 2026-09-25: cada turno terminaba en handoff "error" porque
 * esa revisión reventaba dentro del mismo try que el turno.)
 */

const { execute, runAgentTurn, applyHandoff, selectState } = vi.hoisted(() => ({
  execute: vi.fn(),
  runAgentTurn: vi.fn(),
  applyHandoff: vi.fn(),
  selectState: { throws: false },
}));

function selectChain() {
  const c: Record<string, unknown> = {};
  for (const m of ["from", "where"]) c[m] = () => c;
  c.limit = () => {
    if (selectState.throws) return Promise.reject(new TypeError("a.toISOString is not a function"));
    return Promise.resolve([{ organizationId: "org_1" }]);
  };
  return c;
}
function updateChain() {
  const c: Record<string, unknown> = {};
  c.set = () => c;
  c.where = () => c;
  c.returning = () => Promise.resolve([]);
  return c;
}

vi.mock("@/lib/db", () => ({
  getDb: () => ({ execute, select: () => selectChain(), update: () => updateChain() }),
  schema: { agentJob: {}, message: {} },
}));
vi.mock("@/server/ai/pipeline", () => ({
  applyHandoff,
  runAgentTurn,
  scheduleAgentTurn: vi.fn(),
}));

import { claimUpToCapacity, resetWorkerStateForTests } from "@/server/ai/worker";

describe("worker: fallo después del turno", () => {
  beforeEach(() => {
    execute.mockReset();
    runAgentTurn.mockReset();
    applyHandoff.mockReset();
    applyHandoff.mockResolvedValue(undefined);
    selectState.throws = false;
    let served = false;
    execute.mockImplementation(async () => {
      if (served) return [];
      served = true;
      return [{ id: "job_1", conversationId: "conv_1", lockedAt: "2026-09-25 22:28:17.075351" }];
    });
    resetWorkerStateForTests();
    vi.stubEnv("AGENT_WORKER_CONCURRENCY", "1");
  });

  it("un turno exitoso seguido de un fallo en la contabilidad no pausa la conversación", async () => {
    runAgentTurn.mockResolvedValue(undefined);
    selectState.throws = true;
    await claimUpToCapacity();
    // Dispatch v2: `job.id` viaja como dispatchId (segundo argumento).
    await vi.waitFor(() => expect(runAgentTurn).toHaveBeenCalledWith("conv_1", "job_1"));
    await new Promise((r) => setTimeout(r, 20));
    expect(applyHandoff).not.toHaveBeenCalled();
  });

  it("si el turno falla, sí escala con handoff error", async () => {
    runAgentTurn.mockRejectedValue(new Error("Nea no respondió"));
    await claimUpToCapacity();
    await vi.waitFor(() => expect(applyHandoff).toHaveBeenCalledWith("conv_1", "org_1", "error"));
  });
});

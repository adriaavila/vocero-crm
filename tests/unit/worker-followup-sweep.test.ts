import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * El poll del worker (cada 1s) corre el sweep del seguimiento automático a lo
 * sumo cada 60s, y un sweep que falla no detiene el poll.
 */

const { execute, sweepFollowups, applyHandoff, scheduleAgentTurn, staleRows } = vi.hoisted(() => ({
  execute: vi.fn(async () => []),
  sweepFollowups: vi.fn(async () => 0),
  applyHandoff: vi.fn(async () => {}),
  scheduleAgentTurn: vi.fn(async () => {}),
  /** Lo que devuelve el UPDATE de `markStaleJobs` en su próxima llamada. */
  staleRows: [] as { id: string; conversationId: string; organizationId: string }[][],
}));

function updateChain() {
  const c: Record<string, unknown> = {};
  c.set = () => c;
  c.where = () => c;
  c.returning = () => Promise.resolve(staleRows.shift() ?? []);
  return c;
}

vi.mock("@/lib/db", () => ({
  getDb: () => ({ execute, update: () => updateChain() }),
  schema: { agentJob: {}, message: {}, conversation: {} },
}));
vi.mock("@/server/ai/pipeline", () => ({
  applyHandoff,
  runAgentTurn: vi.fn(),
  scheduleAgentTurn,
}));
vi.mock("@/server/ai/followup", () => ({
  sweepFollowups,
  isFollowupJobId: (id: string) => id.startsWith("ajfu_"),
}));

import { resetWorkerStateForTests, startAgentWorker } from "@/server/ai/worker";

describe("worker: sweep del seguimiento automático", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    execute.mockClear();
    sweepFollowups.mockReset().mockResolvedValue(0);
    applyHandoff.mockClear();
    scheduleAgentTurn.mockClear();
    staleRows.length = 0;
    resetWorkerStateForTests();
    vi.stubEnv("ALLOK_SAAS_MODE", "true");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
    resetWorkerStateForTests();
  });

  it("corre al arrancar y después a lo sumo una vez por minuto", async () => {
    startAgentWorker();
    await vi.advanceTimersByTimeAsync(0);
    expect(sweepFollowups).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(58_000);
    expect(sweepFollowups).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(3_000);
    expect(sweepFollowups).toHaveBeenCalledTimes(2);
  });

  it("un sweep que falla no detiene el poll", async () => {
    sweepFollowups.mockRejectedValueOnce(new Error("se cayó la base"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    startAgentWorker();
    await vi.advanceTimersByTimeAsync(0);
    const claimsBefore = execute.mock.calls.length;
    await vi.advanceTimersByTimeAsync(5_000);

    expect(execute.mock.calls.length).toBeGreaterThan(claimsBefore);
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });

  it("un seguimiento interrumpido (stale) no pausa el chat: re-agenda el turno normal; un turno normal sí escala", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    staleRows.push([
      { id: "ajfu_cv_1", conversationId: "cv_1", organizationId: "org_1" },
      { id: "aj_normal", conversationId: "cv_2", organizationId: "org_1" },
    ]);

    startAgentWorker();
    await vi.advanceTimersByTimeAsync(0);

    expect(scheduleAgentTurn).toHaveBeenCalledWith("cv_1");
    expect(applyHandoff).not.toHaveBeenCalledWith("cv_1", expect.anything(), expect.anything());
    expect(applyHandoff).toHaveBeenCalledWith("cv_2", "org_1", "error");
  });
});

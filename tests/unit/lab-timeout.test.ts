import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runAgentTurn = vi.fn();
const updates: Array<Record<string, unknown>> = [];
const selectQueue: unknown[][] = [];

vi.mock("@/server/ai/pipeline", () => ({ runAgentTurn }));
vi.mock("@/server/lab/judge", () => ({
  computeScore: () => 100,
  judgeCase: vi.fn().mockResolvedValue({
    status: "done",
    verdict: { veredicto: "verde", hallazgos: [] },
  }),
}));
vi.mock("@/server/events/bus", () => ({ publish: vi.fn() }));

function chain(rows: unknown[]) {
  const value: Record<string, unknown> = {};
  for (const method of ["from", "where", "orderBy", "limit"]) {
    value[method] = () => value;
  }
  value.then = (resolve: (result: unknown) => void) =>
    Promise.resolve(rows).then(resolve);
  return value;
}

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => chain(selectQueue.shift() ?? []),
    insert: () => ({
      values: (values: unknown) => {
        const rows = Array.isArray(values) ? values : [values];
        const result = {
          onConflictDoNothing: () => result,
          returning: () => Promise.resolve(rows),
          then: (resolve: (value: unknown) => void) =>
            Promise.resolve(rows).then(resolve),
        };
        return result;
      },
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => {
        updates.push(values);
        const result = {
          where: () => result,
          returning: () => Promise.resolve([{}]),
          then: (resolve: (value: unknown) => void) =>
            Promise.resolve([{}]).then(resolve),
        };
        return result;
      },
    }),
  }),
  schema: new Proxy(
    {},
    {
      get: (_target, table) =>
        new Proxy({}, { get: (_row, column) => `${String(table)}.${String(column)}` }),
    }
  ),
}));

describe("timeout del Laboratorio", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    updates.length = 0;
    selectQueue.length = 0;
    runAgentTurn.mockReset();
  });

  afterEach(() => vi.useRealTimers());

  it("una corrida vencida nunca vuelve de failed a done", async () => {
    let releaseTurn!: () => void;
    const { runAgentTurn: mockedTurn } = await import("@/server/ai/pipeline");
    const turnSpy = vi.mocked(mockedTurn);
    turnSpy.mockImplementation(
      () => new Promise<void>((resolve) => (releaseTurn = resolve))
    );
    selectQueue.push(
      [{ id: "case_1", persona: "comprador_decidido", createdAt: new Date() }],
      [],
      [{ name: "Agente", tone: null, instructions: null, escalationRules: null }],
      [{ handoffAt: new Date() }],
      [{ direction: "in", text: "hola", createdAt: new Date() }],
      [{ status: "done", veredicto: "verde" }]
    );

    const { startRun } = await import("@/server/lab/runner");
    await startRun("org_1");
    await vi.advanceTimersByTimeAsync(0);
    for (let i = 0; i < 20 && turnSpy.mock.calls.length === 0; i += 1) {
      await Promise.resolve();
    }
    expect(turnSpy).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(updates.some((value) => value.status === "failed")).toBe(true);

    releaseTurn();
    for (let i = 0; i < 10 && selectQueue.length > 0; i += 1) {
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();
    }
    expect(updates.some((value) => value.status === "done")).toBe(false);
  });
});

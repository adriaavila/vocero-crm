import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Robustez del Laboratorio con Nea (turnos que pueden tardar y fallar de
 * verdad, no solo un LLM directo):
 *
 *  1. Un despacho que agota sus reintintos en UNA persona no tumba la corrida
 *     entera — se marca esa persona (sin un status "failed" propio en el
 *     esquema, se reusa "judge_failed": ambos significan "sin veredicto") y
 *     se sigue con las demás.
 *  2. La señal de aborto (timeout de la corrida) se revisa ANTES DE CADA
 *     turno dentro del guion, no solo entre personas — un guion de varias
 *     líneas no debe seguir despachando turnos después de que la corrida ya
 *     se dio por vencida.
 *  3. Con Nea configurada, el timeout de la corrida sube a 30 minutos (un
 *     turno despachado, con sus reintentos, puede tardar mucho más que una
 *     llamada directa al LLM).
 */

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
  value.then = (resolve: (result: unknown) => void) => Promise.resolve(rows).then(resolve);
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
          then: (resolve: (value: unknown) => void) => Promise.resolve(rows).then(resolve),
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
          then: (resolve: (value: unknown) => void) => Promise.resolve([{}]).then(resolve),
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

describe("Laboratorio con Nea — resiliencia de la corrida", () => {
  beforeEach(() => {
    updates.length = 0;
    selectQueue.length = 0;
    runAgentTurn.mockReset();
    vi.resetModules();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("un despacho que falla en una persona se marca sin veredicto; la corrida sigue con la siguiente y termina 'done'", async () => {
    selectQueue.push(
      [
        { id: "case_1", persona: "comprador_decidido", createdAt: new Date() },
        { id: "case_2", persona: "comprador_decidido", createdAt: new Date() },
      ], // cases
      [], // kb
      [{ name: "Agente", tone: null, instructions: null, escalationRules: null }], // perfil
      [], // credenciales de IA (getAiRuntimeConfig)
      [{ handoffAt: new Date() }], // case_2: handoff tras el primer turno
      [{ direction: "in", text: "hola", createdAt: new Date() }], // case_2: transcripción
      [
        { status: "judge_failed", veredicto: null },
        { status: "done", veredicto: "verde" },
      ] // finalCases
    );
    runAgentTurn
      .mockRejectedValueOnce(new Error("Nea devolvió 500 (reintentos agotados)")) // case_1
      .mockResolvedValueOnce(undefined); // case_2

    const { startRun } = await import("@/server/lab/runner");
    await startRun("org_1");
    // fire-and-forget: deja correr la corrida completa. Cada vuelta de
    // macrotask agota TODOS los microtasks pendientes primero, así que es
    // más confiable que contar ticks exactos de una cadena de `await`s larga.
    for (let i = 0; i < 40 && !updates.some((u) => u.status === "done"); i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    expect(runAgentTurn).toHaveBeenCalledTimes(2);
    expect(updates.some((u) => u.status === "judge_failed" && u.transcript === undefined)).toBe(
      true
    ); // case_1: se marcó SIN pasar por judgeCase (nunca tuvo transcript)
    expect(updates.some((u) => u.status === "done")).toBe(true); // la corrida terminó, no quedó "failed"
    expect(updates.some((u) => u.status === "failed")).toBe(false);
  });

  it("revisa la señal de aborto ANTES de cada turno: un guion de varias líneas no sigue despachando tras el timeout", async () => {
    vi.useFakeTimers();
    let releaseFirstTurn!: () => void;
    runAgentTurn.mockImplementation(
      () => new Promise<void>((resolve) => (releaseFirstTurn = resolve))
    );
    selectQueue.push(
      [{ id: "case_1", persona: "comprador_decidido", createdAt: new Date() }], // cases (guion de 4 líneas)
      [], // kb
      [{ name: "Agente", tone: null, instructions: null, escalationRules: null }], // perfil
      [], // credenciales de IA
      [{ handoffAt: null }] // si llegara a revisar handoff tras el turno 1 (no debería)
    );

    const { startRun } = await import("@/server/lab/runner");
    await startRun("org_1");
    await vi.advanceTimersByTimeAsync(0);
    for (let i = 0; i < 20 && runAgentTurn.mock.calls.length === 0; i += 1) {
      await Promise.resolve();
    }
    expect(runAgentTurn).toHaveBeenCalledTimes(1); // primer turno del guion, en vuelo

    // Se agota el timeout de la corrida (10 min, sin Nea configurada aquí):
    // dispara `controller.abort()` mientras el primer turno sigue esperando.
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);

    // Ahora se libera el primer turno: el guion tiene 3 líneas más, pero la
    // señal ya está abortada — no debería despachar ninguna más.
    releaseFirstTurn();
    for (let i = 0; i < 20; i += 1) {
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();
    }

    expect(runAgentTurn).toHaveBeenCalledTimes(1);
  });

  it("con Nea configurada, el timeout de la corrida es de 30 minutos, no 10", async () => {
    vi.useFakeTimers();
    vi.stubEnv("BOT_API_KEY", "clave-compartida-con-nea-larga");
    vi.stubEnv("NEA_DISPATCH_URL", "http://nea-agent:8000/dispatch");
    runAgentTurn.mockImplementation(() => new Promise<void>(() => {})); // nunca resuelve
    selectQueue.push(
      [{ id: "case_1", persona: "comprador_decidido", createdAt: new Date() }],
      [],
      [{ name: "Agente", tone: null, instructions: null, escalationRules: null }],
      []
    );

    const { startRun } = await import("@/server/lab/runner");
    await startRun("org_1");
    await vi.advanceTimersByTimeAsync(0);
    for (let i = 0; i < 20 && runAgentTurn.mock.calls.length === 0; i += 1) {
      await Promise.resolve();
    }

    // A los 10 minutos, con Nea configurada, la corrida NO debería fallar todavía.
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(updates.some((u) => u.status === "failed")).toBe(false);

    // A los 30 minutos sí.
    await vi.advanceTimersByTimeAsync(20 * 60 * 1000);
    expect(updates.some((u) => u.status === "failed")).toBe(true);
  });
});

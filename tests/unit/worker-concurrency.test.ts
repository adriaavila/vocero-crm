import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `claimUpToCapacity` — el cupo de concurrencia del worker de SaaS.
 *
 * Antes, `poll()` reclamaba UN trabajo y esperaba (`await processJob(...)`)
 * a que terminara antes de reclamar el siguiente — un solo turno lento (un
 * despacho a Nea colgado) bloqueaba a TODOS los demás negocios. Ahora reclama
 * hasta `AGENT_WORKER_CONCURRENCY` (default 4) SIN esperar a que los
 * anteriores terminen.
 */

const { execute, runAgentTurn, cleanupState } = vi.hoisted(() => ({
  execute: vi.fn(),
  runAgentTurn: vi.fn(),
  cleanupState: { throwOnUpdate: false },
}));

function selectChain(rows: unknown[] = []) {
  const c: Record<string, unknown> = {};
  for (const m of ["from", "where"]) c[m] = () => c;
  c.limit = () => Promise.resolve(rows);
  return c;
}
function updateChain() {
  const c: Record<string, unknown> = {};
  c.set = () => c;
  c.where = () => {
    if (cleanupState.throwOnUpdate) {
      throw new Error("la BD se cayó justo al limpiar el trabajo");
    }
    return c;
  };
  c.returning = () => Promise.resolve([]);
  return c;
}

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    execute,
    select: () => selectChain([]),
    update: () => updateChain(),
  }),
  schema: { agentJob: {}, message: {}, conversation: { agentCursorAt: "agentCursorAt", id: "id" } },
}));
vi.mock("@/server/ai/pipeline", () => ({
  applyHandoff: vi.fn(),
  runAgentTurn,
  scheduleAgentTurn: vi.fn(),
}));

import { claimUpToCapacity, resetWorkerStateForTests } from "@/server/ai/worker";

describe("claimUpToCapacity (cupo de concurrencia)", () => {
  let deferreds: { resolve: () => void }[] = [];
  let claimed = 0;

  beforeEach(() => {
    execute.mockReset();
    runAgentTurn.mockReset();
    cleanupState.throwOnUpdate = false;
    deferreds = [];
    claimed = 0;
    // Cada llamada a `execute` simula el CTE de `claimNextJob`: un trabajo
    // disponible por llamada, hasta 5.
    execute.mockImplementation(async () => {
      claimed++;
      return claimed <= 5
        ? [{ id: `job_${claimed}`, conversationId: `conv_${claimed}`, lockedAt: new Date() }]
        : [];
    });
    // `runAgentTurn` no resuelve sola: el test decide cuándo "termina" cada turno.
    runAgentTurn.mockImplementation(
      () => new Promise<void>((resolve) => deferreds.push({ resolve }))
    );
    resetWorkerStateForTests();
    vi.stubEnv("AGENT_WORKER_CONCURRENCY", "2");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("reclama hasta el cupo configurado y se detiene ahí, sin esperar a que los turnos en vuelo terminen", async () => {
    await claimUpToCapacity();

    // Cupo = 2: reclama job_1 y job_2, se detiene aunque job_3 siga disponible.
    expect(execute).toHaveBeenCalledTimes(2);
    expect(runAgentTurn).toHaveBeenCalledTimes(2);
    // Dispatch v2: `job.id` viaja como dispatchId (segundo argumento).
    expect(runAgentTurn).toHaveBeenCalledWith("conv_1", "job_1");
    expect(runAgentTurn).toHaveBeenCalledWith("conv_2", "job_2");
    // Ninguno de los dos turnos "en vuelo" ha terminado todavía.
    expect(deferreds).toHaveLength(2);
  });

  it("libera un cupo cuando un turno termina y lo usa en la siguiente pasada", async () => {
    await claimUpToCapacity();
    expect(execute).toHaveBeenCalledTimes(2);

    // job_1 termina.
    deferreds[0]!.resolve();
    // deja correr toda la cadena async de `processJob` (update + select +
    // el `.finally()` que decrementa `inFlight`) antes de seguir.
    await new Promise((resolve) => setTimeout(resolve, 0));

    await claimUpToCapacity();

    // Ahora sí reclama job_3 (el cupo liberado por job_1).
    expect(execute).toHaveBeenCalledTimes(3);
    expect(runAgentTurn).toHaveBeenCalledWith("conv_3", "job_3");
  });

  it("con AGENT_WORKER_CONCURRENCY=1, un turno en vuelo bloquea el resto (comportamiento explícito, no accidental)", async () => {
    vi.stubEnv("AGENT_WORKER_CONCURRENCY", "1");

    await claimUpToCapacity();

    expect(execute).toHaveBeenCalledTimes(1);
    expect(runAgentTurn).toHaveBeenCalledTimes(1);
  });

  it("sin AGENT_WORKER_CONCURRENCY configurada, usa el default (4)", async () => {
    vi.stubEnv("AGENT_WORKER_CONCURRENCY", "");

    await claimUpToCapacity();

    expect(execute).toHaveBeenCalledTimes(4);
    expect(runAgentTurn).toHaveBeenCalledTimes(4);
  });

  it("si la LIMPIEZA de un trabajo fallido también falla, no se escapa como una promesa sin manejar", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    runAgentTurn.mockImplementation(() => Promise.reject(new Error("Nea devolvió 500")));
    cleanupState.throwOnUpdate = true;

    await claimUpToCapacity();
    // Deja correr la cadena `.catch().finally()` de `processJob` — si el
    // `.catch()` que protege la limpieza no estuviera, esto se reportaría
    // como un "Unhandled Rejection" y la suite fallaría, no esta aserción.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("limpieza del trabajo"),
      expect.any(Error)
    );
    errorSpy.mockRestore();
  });
});

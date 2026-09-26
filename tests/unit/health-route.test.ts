import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `agentQueue` es una señal de monitoreo sobre el worker del agente, no parte
 * del veredicto de salud. Estos tests fijan:
 *  - que nunca cambia el status ni el código HTTP de la respuesta;
 *  - que solo se calcula en modo SaaS —en self-hosted responde "n/a" SIN
 *    tocar la base—;
 *  - que es UNA sola ida a la base (dos `exists()`, no dos consultas) con
 *    los cortes de 60m/5m correctos, bajo tiempo fijo;
 *  - que una consulta que nunca resuelve se CANCELA cuando pasa el timeout
 *    (no solo "se deja de esperar": eso es justo el bug que se reprodujo en
 *    revisión — la consulta seguía viva, sosteniendo una conexión del pool);
 *  - que un rechazo de la consulta (error de BD ajeno al timeout) también
 *    degrada sin tocar el veredicto general, que sigue dependiendo solo del
 *    `select 1`.
 */

vi.mock("next/headers", () => ({
  // Un host desconocido bastaría para 404 antes de llegar a lo que se prueba
  // aquí; "localhost" es un host de app válido (no un tenant), así que deja
  // pasar sin necesitar mockear `@/lib/tenant-host` ni resolver organización.
  headers: async () => new Map([["host", "localhost"]]),
}));

type FakeEnv = { NODE_ENV: string; META_APP_SECRET: string | undefined };
const envState = vi.hoisted(() => ({
  getEnv: vi.fn<() => FakeEnv>(() => ({ NODE_ENV: "test", META_APP_SECRET: "secret" })),
}));
vi.mock("@/lib/env", () => ({ getEnv: envState.getEnv }));

type AgentQueueRow = { needsReview: boolean; staleQueued: boolean };
type PendingQuery<T> = Promise<T> & { cancel: () => void };
type SqlCall = { text: string; values: unknown[] };

const dbState = vi.hoisted(() => ({
  execute: vi.fn(async () => [{ "?column?": 1 }]),
  calls: [] as SqlCall[],
  behavior: "resolve" as "resolve" | "reject" | "never",
  result: [{ needsReview: false, staleQueued: false }] as AgentQueueRow[],
  cancelCount: 0,
}));

vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();

  // Imita la forma real de `postgres`: la plantilla etiquetada devuelve una
  // "pending query" — un thenable con `.cancel()` — no una promesa plana.
  // `.cancel()` debe rechazarla de verdad (como hace Postgres al abortar la
  // consulta), o el test no distingue este fix de la versión rota.
  function sqlTag(strings: TemplateStringsArray, ...values: unknown[]) {
    dbState.calls.push({ text: strings.join("¶"), values });
    let rejectFn!: (err: unknown) => void;
    let resolveFn!: (rows: AgentQueueRow[]) => void;
    const promise = new Promise<AgentQueueRow[]>((resolve, reject) => {
      resolveFn = resolve;
      rejectFn = reject;
    }) as PendingQuery<AgentQueueRow[]>;
    promise.cancel = () => {
      dbState.cancelCount++;
      rejectFn(Object.assign(new Error("query_canceled"), { code: "57014" }));
    };
    if (dbState.behavior === "resolve") queueMicrotask(() => resolveFn(dbState.result));
    if (dbState.behavior === "reject") queueMicrotask(() => rejectFn(new Error("connection reset")));
    // "never": no se resuelve ni rechaza sola — solo por `.cancel()`.
    return promise;
  }

  return {
    ...actual,
    getDb: () => ({ execute: dbState.execute }),
    getSql: () => sqlTag,
  };
});

import { GET } from "@/app/api/health/route";

describe("GET /api/health", () => {
  beforeEach(() => {
    envState.getEnv.mockReturnValue({ NODE_ENV: "test", META_APP_SECRET: "secret" });
    dbState.execute.mockReset().mockResolvedValue([{ "?column?": 1 }]);
    dbState.calls = [];
    dbState.behavior = "resolve";
    dbState.result = [{ needsReview: false, staleQueued: false }];
    dbState.cancelCount = 0;
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("no declara saludable una producción sin firma de Meta", async () => {
    envState.getEnv.mockReturnValue({ NODE_ENV: "production", META_APP_SECRET: undefined });
    const response = await GET();
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code: "webhook_unconfigured" },
    });
  });

  describe("fuera de modo SaaS", () => {
    it('agentQueue: "n/a" sin consultar agent_job', async () => {
      const response = await GET();
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ ok: true, agentQueue: "n/a" });
      expect(dbState.calls).toHaveLength(0);
    });
  });

  describe("en modo SaaS", () => {
    beforeEach(() => vi.stubEnv("ALLOK_SAAS_MODE", "true"));

    it("es UNA sola consulta, con los cortes de 60m y 5m exactos", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-09-26T12:00:00.000Z"));

      const response = await GET();
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ ok: true, agentQueue: "ok" });

      // Dos `exists()`, sí; dos viajes a la base, no — eso era exactamente lo
      // que sostenía dos conexiones del pool por cada healthcheck.
      expect(dbState.calls).toHaveLength(1);
      const call = dbState.calls[0];
      if (!call) throw new Error("se esperaba una consulta");
      expect(call.text).toContain("status = 'needs_review'");
      expect(call.text).toContain("updated_at >=");
      expect(call.text).toContain("status = 'queued'");
      expect(call.text).toContain("available_at <=");
      expect(call.values).toEqual([
        new Date("2026-09-26T11:00:00.000Z").toISOString(), // ahora - 60 min
        new Date("2026-09-26T11:55:00.000Z").toISOString(), // ahora - 5 min
      ]);
    });

    it('agentQueue: "degraded" cuando hay needs_review reciente', async () => {
      dbState.result = [{ needsReview: true, staleQueued: false }];
      const response = await GET();
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ ok: true, agentQueue: "degraded" });
    });

    it('agentQueue: "degraded" cuando hay un queued viejo', async () => {
      dbState.result = [{ needsReview: false, staleQueued: true }];
      const response = await GET();
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ ok: true, agentQueue: "degraded" });
    });

    it("una consulta que nunca resuelve se CANCELA al vencer el timeout (no solo se deja de esperar)", async () => {
      vi.useFakeTimers();
      dbState.behavior = "never";

      const responsePromise = GET();
      // Pasa el AGENT_QUEUE_QUERY_TIMEOUT_MS (750ms) del route.
      await vi.advanceTimersByTimeAsync(1000);
      const response = await responsePromise;

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ ok: true, agentQueue: "degraded" });
      // La prueba de que se canceló DE VERDAD, no que la promesa simplemente
      // se dejó de esperar mientras la consulta seguía viva en el servidor.
      expect(dbState.cancelCount).toBe(1);
      // El select 1 (el veredicto real) no depende de esto y sí corrió.
      expect(dbState.execute).toHaveBeenCalled();
    });

    it("una consulta que rechaza (error de BD ajeno al timeout) degrada sin tocar el veredicto general", async () => {
      dbState.behavior = "reject";
      const response = await GET();
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ ok: true, agentQueue: "degraded" });
      expect(dbState.execute).toHaveBeenCalled();
    });

    it("dos healthchecks casi simultáneos comparten una sola consulta en vuelo", async () => {
      const [a, b] = await Promise.all([GET(), GET()]);
      await expect(a.json()).resolves.toMatchObject({ agentQueue: "ok" });
      await expect(b.json()).resolves.toMatchObject({ agentQueue: "ok" });
      expect(dbState.calls).toHaveLength(1);
    });

    it("la respuesta pública nunca lleva ids ni conteos de agent_job", async () => {
      dbState.result = [{ needsReview: true, staleQueued: false }];
      const response = await GET();
      const body = (await response.json()) as Record<string, unknown>;
      expect(Object.keys(body).sort()).toEqual(["agentQueue", "ok", "version"]);
      expect(body.agentQueue).toBe("degraded");
    });
  });
});

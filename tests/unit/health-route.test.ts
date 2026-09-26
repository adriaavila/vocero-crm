import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `agentQueue` es una señal de monitoreo sobre el worker del agente, no parte
 * del veredicto de salud: estos tests fijan que (a) nunca cambia el status ni
 * el código HTTP de la respuesta, (b) solo se calcula en modo SaaS —en modo
 * self-hosted responde "n/a" SIN tocar la base—, y (c) usa las dos consultas
 * exactas que documenta la ruta (needs_review reciente, queued viejo).
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

const dbState = vi.hoisted(() => ({
  execute: vi.fn(async () => [{ "?column?": 1 }]),
  queue: [] as unknown[][],
  select: vi.fn(),
}));
vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "where", "limit"]) {
    chain[m] = () => chain;
  }
  (chain as { then: (resolve: (v: unknown) => void) => void }).then = (resolve) =>
    resolve(dbState.queue.shift() ?? []);
  dbState.select.mockImplementation(() => chain);
  return {
    ...actual,
    getDb: () => ({ execute: dbState.execute, select: dbState.select }),
  };
});

import { GET } from "@/app/api/health/route";

describe("GET /api/health", () => {
  beforeEach(() => {
    envState.getEnv.mockReturnValue({ NODE_ENV: "test", META_APP_SECRET: "secret" });
    dbState.execute.mockReset().mockResolvedValue([{ "?column?": 1 }]);
    dbState.select.mockClear();
    dbState.queue = [];
  });
  afterEach(() => vi.unstubAllEnvs());

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
      // ALLOK_SAAS_MODE sin definir: self-hosted, el worker in-process no
      // aplica aquí.
      const response = await GET();
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ ok: true, agentQueue: "n/a" });
      expect(dbState.select).not.toHaveBeenCalled();
    });
  });

  describe("en modo SaaS", () => {
    beforeEach(() => vi.stubEnv("ALLOK_SAAS_MODE", "true"));

    it('agentQueue: "ok" sin needs_review reciente ni queued viejo', async () => {
      dbState.queue = [[], []];
      const response = await GET();
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ ok: true, agentQueue: "ok" });
    });

    it('agentQueue: "degraded" por un needs_review de la última hora', async () => {
      dbState.queue = [[{ id: "aj_needs_review" }], []];
      const response = await GET();
      // El veredicto general NO cambia por esto: sigue 200/ok:true.
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ ok: true, agentQueue: "degraded" });
    });

    it('agentQueue: "degraded" por un queued listo hace más de 5 minutos', async () => {
      dbState.queue = [[], [{ id: "aj_stale_queued" }]];
      const response = await GET();
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ ok: true, agentQueue: "degraded" });
    });

    it("la respuesta pública nunca lleva ids ni conteos de agent_job", async () => {
      dbState.queue = [[{ id: "aj_secreto" }], []];
      const response = await GET();
      const body = (await response.json()) as Record<string, unknown>;
      expect(JSON.stringify(body)).not.toContain("aj_secreto");
      expect(body.agentQueue).toBe("degraded");
    });
  });
});

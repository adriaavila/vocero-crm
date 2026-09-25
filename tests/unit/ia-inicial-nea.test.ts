import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `iaInicialPara` — ¿la IA nace encendida en una conversación nueva?
 *
 * IMPORTANTE: con Nea configurada, esto tiene que preguntar exactamente lo
 * mismo que Rei (`profile.enabled`) y NADA más. Antes de este freno,
 * `cerebroExternoAtiende` (que hoy solo mira si HAY una clave, sin fijarse en
 * `profile.enabled`) encendía la conversación igual, así que "allok contesta
 * por ti" aparecía en el punto/la barra lateral con el agente apagado — Nea
 * SÍ respeta `profile.enabled` antes de despachar (`pipeline.ts`), el CRM no
 * debía prometer lo contrario.
 *
 * Sin `NEA_DISPATCH_URL` (cerebro externo LEGADO, comportamiento de `main`
 * sin cambios) `profile.enabled=false` NO apaga nada: ese bot escucha su
 * propio webhook y el CRM no controla si contesta.
 */

const selectQueue: unknown[][] = [];
function chain(rows: unknown[]) {
  const c: Record<string, unknown> = {};
  for (const m of ["from", "where"]) c[m] = () => c;
  c.limit = () => Promise.resolve(rows);
  return c;
}

vi.mock("@/lib/db", () => ({
  getDb: () => ({ select: () => chain(selectQueue.shift() ?? []) }),
  schema: new Proxy(
    {},
    {
      get: (_t, tableName) =>
        new Proxy({}, { get: (_t2, col) => `${String(tableName)}.${String(col)}` }),
    }
  ),
}));

import { iaInicialPara } from "@/server/agencia/ia-inicial";

describe("iaInicialPara", () => {
  beforeEach(() => {
    selectQueue.length = 0;
  });
  afterEach(() => vi.unstubAllEnvs());

  it("Nea configurada + profile.enabled=false → NO nace encendida", async () => {
    vi.stubEnv("BOT_API_KEY", "clave-compartida-con-nea-larga");
    vi.stubEnv("NEA_DISPATCH_URL", "http://nea-agent:8000/dispatch");
    selectQueue.push([{ enabled: false, activationEnabled: false }]);

    expect(await iaInicialPara("org_1")).toBe(false);
  });

  it("Nea configurada + profile.enabled=true → nace encendida", async () => {
    vi.stubEnv("BOT_API_KEY", "clave-compartida-con-nea-larga");
    vi.stubEnv("NEA_DISPATCH_URL", "http://nea-agent:8000/dispatch");
    selectQueue.push([{ enabled: true, activationEnabled: false }]);

    expect(await iaInicialPara("org_1")).toBe(true);
  });

  it("cerebro externo LEGADO (solo BOT_API_KEY, sin NEA_DISPATCH_URL) + profile.enabled=false → SÍ nace encendida, igual que main", async () => {
    vi.stubEnv("ALLOK_SAAS_MODE", "");
    vi.stubEnv("BOT_API_KEY", "clave-compartida-con-nea-larga");
    vi.stubEnv("NEA_DISPATCH_URL", "");
    selectQueue.push([{ enabled: false, activationEnabled: false }]);

    expect(await iaInicialPara("org_1")).toBe(true);
  });

  it("sin ningún cerebro externo, profile.enabled=false → no nace encendida", async () => {
    vi.stubEnv("ALLOK_SAAS_MODE", "");
    vi.stubEnv("BOT_API_KEY", "");
    vi.stubEnv("NEA_DISPATCH_URL", "");
    selectQueue.push([{ enabled: false, activationEnabled: false }]);

    expect(await iaInicialPara("org_1")).toBe(false);
  });
});

import { describe, expect, it, vi } from "vitest";

/**
 * Guardarraíl del contrato de agencia con el cerebro externo.
 *
 * Nea lee `activationEnabled` de `/api/bot/profile` y `agentAccess` de
 * `/api/bot/context`. Si una fusión con upstream se lleva esos campos por
 * delante, el bot no falla: lee `undefined`, concluye "sin freno" y se suelta
 * a contestarle a cualquiera. El piloto queda sin allowlist y sin activación
 * por mensaje, y nadie se entera hasta que un lead real recibe algo que no
 * debía.
 *
 * Este test existe para que eso truene en CI en vez de en producción.
 */

vi.mock("@/server/bot/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/bot/auth")>();
  return {
    ...actual,
    requireBotKey: () => null,
    resolveInstanceOrg: async () => "org_1",
  };
});

const perfil = {
  id: "ap_1",
  organizationId: "org_1",
  enabled: true,
  name: "Nea",
  tone: null,
  instructions: null,
  escalationRules: null,
  greeting: null,
  activationEnabled: true,
  activationMessages: ["quiero informacion"],
  allowlistEnabled: true,
  allowedWaIds: ["5215512345678"],
  lastLiveTestAt: null,
  lastLiveTestPassed: null,
  lastLiveTestElapsedMs: null,
  aiProvider: "openai" as const,
  createdAt: new Date(),
  updatedAt: new Date(),
};

/** Constructor de la cadena `select().from().where().limit()` de Drizzle. */
function query(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const k of ["from", "where", "limit", "innerJoin", "leftJoin", "orderBy"]) {
    chain[k] = () => chain;
  }
  chain.then = (resolve: (v: unknown) => unknown) => resolve(rows);
  return chain;
}

vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  return {
    ...actual,
    getDb: () => ({ select: () => query([perfil]) }),
  };
});

import { perfilDeAgencia, accesoDeAgencia } from "@/server/agencia/bot-perfil";

describe("contrato de agencia con el cerebro externo", () => {
  it("el perfil lleva los mensajes de activación", async () => {
    const out = await perfilDeAgencia("org_1");
    expect(out.activationEnabled).toBe(true);
    expect(out.activationMessages).toEqual(["quiero informacion"]);
  });

  it("el contexto lleva la allowlist", async () => {
    const out = await accesoDeAgencia("org_1");
    expect(out.allowlistEnabled).toBe(true);
    expect(out.allowedWaIds).toEqual(["5215512345678"]);
  });

  it("las rutas los siguen sirviendo (no solo el módulo)", async () => {
    const perfilRoute = await import("@/app/api/bot/profile/route");
    const contextRoute = await import("@/app/api/bot/context/route");
    // Se lee el código: montar Next entero aquí costaría más de lo que aporta,
    // y lo que se protege es que la ruta SIGA llamando a la capa de agencia.
    const { readFileSync } = await import("node:fs");
    const p = readFileSync("src/app/api/bot/profile/route.ts", "utf8");
    const c = readFileSync("src/app/api/bot/context/route.ts", "utf8");
    expect(typeof perfilRoute.GET).toBe("function");
    expect(typeof contextRoute.GET).toBe("function");
    expect(p).toContain("perfilDeAgencia");
    expect(c).toContain("accesoDeAgencia");
    expect(c).toContain("agentAccess");
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `resolveInstanceOrg` — la frontera de tenant de `/api/bot/*`.
 *
 * Nea despacha por HTTP directo al servicio, no por Host: en SaaS manda
 * `X-Organization-Id` y eso debe resolver ANTES de tocar el Host (que sigue
 * de respaldo para cerebros externos que aún no lo mandan). Legacy es una
 * sola instancia: el header no pinta nada ahí.
 */

const selectQueue: unknown[][] = [];
function chain(rows: unknown[]) {
  const c: Record<string, unknown> = {};
  c.from = () => c;
  c.where = () => c;
  c.limit = () => Promise.resolve(rows);
  return c;
}

vi.mock("@/lib/db", () => ({
  getDb: () => ({ select: () => chain(selectQueue.shift() ?? []) }),
  schema: { organization: { id: "id" } },
}));

const { resolveOrganizationIdForHost } = vi.hoisted(() => ({
  resolveOrganizationIdForHost: vi.fn(async () => "org_from_host"),
}));
vi.mock("@/server/auth/on-signup", () => ({ resolveOrganizationIdForHost }));

import { resetInstanceOrgCache, resolveInstanceOrg } from "@/server/bot/auth";

function reqWith(headers: Record<string, string>): Request {
  return new Request("http://localhost/api/bot/context", { headers });
}

describe("resolveInstanceOrg", () => {
  beforeEach(() => {
    selectQueue.length = 0;
    resolveOrganizationIdForHost.mockClear();
    resetInstanceOrgCache();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("SaaS + X-Organization-Id existente → esa organización, sin tocar el Host", async () => {
    vi.stubEnv("ALLOK_SAAS_MODE", "true");
    selectQueue.push([{ id: "org_1" }]);

    const org = await resolveInstanceOrg(
      reqWith({ "x-organization-id": "org_1", host: "otro-negocio.crm.allok.fun" })
    );

    expect(org).toBe("org_1");
    expect(resolveOrganizationIdForHost).not.toHaveBeenCalled();
  });

  it("SaaS + X-Organization-Id desconocida → null (409 no_org aguas arriba, nunca cae al Host)", async () => {
    vi.stubEnv("ALLOK_SAAS_MODE", "true");
    selectQueue.push([]);

    const org = await resolveInstanceOrg(
      reqWith({ "x-organization-id": "org_fantasma", host: "otro-negocio.crm.allok.fun" })
    );

    expect(org).toBeNull();
    expect(resolveOrganizationIdForHost).not.toHaveBeenCalled();
  });

  it("SaaS sin el header → cae al Host como antes", async () => {
    vi.stubEnv("ALLOK_SAAS_MODE", "true");

    const org = await resolveInstanceOrg(reqWith({ host: "cliente.crm.allok.fun" }));

    expect(org).toBe("org_from_host");
    expect(resolveOrganizationIdForHost).toHaveBeenCalledWith("cliente.crm.allok.fun");
  });

  it("legacy (instancia dedicada) ignora el header por completo", async () => {
    vi.stubEnv("ALLOK_SAAS_MODE", "");
    selectQueue.push([{ id: "org_unica" }]);

    const org = await resolveInstanceOrg(reqWith({ "x-organization-id": "org_1" }));

    expect(org).toBe("org_unica");
    expect(resolveOrganizationIdForHost).not.toHaveBeenCalled();
  });
});

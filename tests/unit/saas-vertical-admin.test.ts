import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Interruptor del vertical inmobiliario desde el panel admin
 * (`POST /api/saas/businesses/[id]/vertical`, fork de agencia). Mismos
 * dobles que `saas-plan-grant.test.ts`: la autorización y la auditoría
 * viven en la ruta.
 */

const headersState = vi.hoisted(() => ({ host: "admin.localhost" }));
vi.mock("next/headers", () => ({
  headers: async () => new Map([["host", headersState.host]]),
}));

type FakeSession = { user: { id: string; email: string; name: string } } | null;
const authState = vi.hoisted(() => ({ session: null as FakeSession }));
vi.mock("@/lib/auth", () => ({
  getAuth: () => ({ api: { getSession: async () => authState.session } }),
}));

type FakeOrg = { id: string; name: string; slug: string | null; metadata: string | null };
type AuditRow = { id: string; userId: string; action: string; organizationId: string | null; detail: string | null };
const dbState = vi.hoisted(() => ({
  org: null as FakeOrg | null,
  auditRows: [] as AuditRow[],
}));

vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  function selectChain() {
    const rows = dbState.org ? [{ ...dbState.org }] : [];
    const c: Record<string, unknown> = {};
    for (const m of ["from", "where", "limit"]) c[m] = () => c;
    // `.for("update")` es siempre el último eslabón antes del await, igual
    // que `.limit()` — no hace falta simular el bloqueo real, solo la forma.
    c.for = () => Promise.resolve(rows);
    (c as { then: unknown }).then = (resolve: (v: unknown) => unknown) => Promise.resolve(rows).then(resolve);
    return c;
  }
  const client = {
    select: () => selectChain(),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: () => {
          if (dbState.org && typeof values.metadata === "string") dbState.org.metadata = values.metadata;
          return Promise.resolve(undefined);
        },
      }),
    }),
    insert: () => ({
      values: (row: Omit<AuditRow, "detail"> & { detail?: string | null }) => {
        dbState.auditRows.push({ detail: null, ...row });
        return Promise.resolve(undefined);
      },
    }),
  };
  return {
    ...actual,
    getDb: () => ({
      ...client,
      transaction: async <T>(fn: (tx: typeof client) => Promise<T>) => fn(client),
    }),
  };
});

import { POST } from "@/app/api/saas/businesses/[id]/vertical/route";
import { verticalFromMetadata } from "@/server/agencia/vertical";

const ADMIN = { user: { id: "user_admin", email: "admin@allok.fun", name: "Admin" } };
const ORG_ID = "org_1";
const ctx = (id = ORG_ID) => ({ params: Promise.resolve({ id }) });
const req = (body: unknown) =>
  new Request(`http://localhost/api/saas/businesses/${ORG_ID}/vertical`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("Catálogo de propiedades desde el panel admin", () => {
  beforeEach(() => {
    vi.stubEnv("ALLOK_SAAS_MODE", "true");
    vi.stubEnv("ALLOK_ADMIN_EMAILS", "admin@allok.fun");
    headersState.host = "admin.localhost";
    authState.session = ADMIN;
    dbState.org = {
      id: ORG_ID,
      name: "SAMER",
      slug: "samer",
      metadata: JSON.stringify({ allok: { billing: { plan: "pro", status: "trialing" } } }),
    };
    dbState.auditRows = [];
  });
  afterEach(() => vi.unstubAllEnvs());

  it("lo enciende sin pisar la facturación, y queda auditado", async () => {
    const res = await POST(req({ vertical: "inmobiliario" }), ctx());
    expect(res.status).toBe(200);
    expect(verticalFromMetadata(dbState.org?.metadata)).toBe("inmobiliario");
    expect(JSON.parse(dbState.org?.metadata ?? "{}").allok.billing.plan).toBe("pro");
    expect(dbState.auditRows.map((row) => row.action)).toEqual(["vertical_on"]);
  });

  it("lo apaga sin tocar el resto de la metadata", async () => {
    await POST(req({ vertical: "inmobiliario" }), ctx());
    const res = await POST(req({ vertical: null }), ctx());
    expect(res.status).toBe(200);
    expect(verticalFromMetadata(dbState.org?.metadata)).toBeNull();
    expect(JSON.parse(dbState.org?.metadata ?? "{}").allok.billing.status).toBe("trialing");
    expect(dbState.auditRows.map((row) => row.action)).toEqual(["vertical_on", "vertical_off"]);
  });

  it("un email que no es admin recibe 404 y no escribe nada", async () => {
    authState.session = { user: { id: "user_x", email: "cliente@allok.fun", name: "Cliente" } };
    const res = await POST(req({ vertical: "inmobiliario" }), ctx());
    expect(res.status).toBe(404);
    expect(verticalFromMetadata(dbState.org?.metadata)).toBeNull();
    expect(dbState.auditRows).toEqual([]);
  });

  it("un vertical desconocido se rechaza con 422", async () => {
    const res = await POST(req({ vertical: "ferreteria" }), ctx());
    expect(res.status).toBe(422);
    expect(dbState.auditRows).toEqual([]);
  });

  it("un negocio que no existe da 404", async () => {
    dbState.org = null;
    const res = await POST(req({ vertical: "inmobiliario" }), ctx("org_x"));
    expect(res.status).toBe(404);
    expect(dbState.auditRows).toEqual([]);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Alta/baja manual de plan (`POST`/`DELETE /api/saas/businesses/[id]/plan`):
 * el respaldo de "paga por link o transferencia" a la concesión que hoy se
 * hace con SQL a mano en producción (specs/018). Se prueba la ruta completa
 * (no solo `grantSaaSPlan`/`revokeSaaSPlan`) porque la autorización y la
 * auditoría viven en `requireSaaSAdmin`, delante de la lógica de negocio.
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
type AuditRow = { id: string; userId: string; action: string; organizationId: string | null };
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
    (c as { then: unknown }).then = (resolve: (v: unknown) => unknown) => Promise.resolve(rows).then(resolve);
    return c;
  }
  return {
    ...actual,
    getDb: () => ({
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
        values: (row: AuditRow) => {
          dbState.auditRows.push(row);
          return Promise.resolve(undefined);
        },
      }),
    }),
  };
});

import { DELETE, POST } from "@/app/api/saas/businesses/[id]/plan/route";

const ADMIN = { user: { id: "user_admin", email: "admin@allok.fun", name: "Admin" } };
const ORG_ID = "org_1";

function ctx(id = ORG_ID) {
  return { params: Promise.resolve({ id }) };
}

function req(method: "POST" | "DELETE", body: unknown): Request {
  return new Request(`http://localhost/api/saas/businesses/${ORG_ID}/plan`, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("Alta/baja manual de plan desde el panel admin", () => {
  beforeEach(() => {
    vi.stubEnv("ALLOK_SAAS_MODE", "true");
    vi.stubEnv("ALLOK_ADMIN_EMAILS", "admin@allok.fun");
    headersState.host = "admin.localhost";
    authState.session = ADMIN;
    dbState.org = { id: ORG_ID, name: "Negocio Uno", slug: "negocio-uno", metadata: null };
    dbState.auditRows = [];
  });
  afterEach(() => vi.unstubAllEnvs());

  describe("autorización", () => {
    it("un email que no está en ALLOK_ADMIN_EMAILS recibe 404 y no escribe nada", async () => {
      authState.session = { user: { id: "user_x", email: "cliente@allok.fun", name: "Cliente" } };
      const res = await POST(req("POST", { plan: "pro" }), ctx());
      expect(res.status).toBe(404);
      expect(dbState.auditRows).toEqual([]);
      expect(dbState.org?.metadata).toBeNull();
    });

    it("un host que no es el admin (p. ej. crm.localhost) recibe 404 aunque el email sea válido", async () => {
      headersState.host = "crm.localhost";
      const res = await POST(req("POST", { plan: "pro" }), ctx());
      expect(res.status).toBe(404);
      expect(dbState.auditRows).toEqual([]);
    });

    it("sin sesión, 404", async () => {
      authState.session = null;
      const res = await POST(req("POST", { plan: "pro" }), ctx());
      expect(res.status).toBe(404);
    });

    it("fuera de modo SaaS, 404 aunque todo lo demás esté bien", async () => {
      vi.stubEnv("ALLOK_SAAS_MODE", "false");
      const res = await POST(req("POST", { plan: "pro" }), ctx());
      expect(res.status).toBe(404);
    });
  });

  describe("conceder un plan", () => {
    it("actualiza la metadata, dejando plan/estado/fuente/quién y cuándo, y audita con la organización", async () => {
      const res = await POST(req("POST", { plan: "pro" }), ctx());
      expect(res.status).toBe(200);
      const body = (await res.json()) as { billing: Record<string, unknown> };
      expect(body.billing).toMatchObject({ plan: "pro", status: "active", grantedBy: "admin@allok.fun" });
      expect(body.billing.source).toMatch(/^manual_\d{4}-\d{2}-\d{2}$/);
      expect(typeof body.billing.grantedAt).toBe("string");

      expect(dbState.auditRows).toHaveLength(1);
      expect(dbState.auditRows[0]).toMatchObject({ userId: "user_admin", action: "grant_plan", organizationId: ORG_ID });
    });

    it("es idempotente: repetirlo confirma el mismo plan sin romper nada", async () => {
      await POST(req("POST", { plan: "pro" }), ctx());
      const res = await POST(req("POST", { plan: "pro" }), ctx());
      expect(res.status).toBe(200);
      expect(dbState.auditRows).toHaveLength(2);
    });

    it("un plan que este despliegue no vende (fuera de SAAS_PLANS) se rechaza con 422", async () => {
      // SAAS_PLANS sin configurar → default basic,pro (inmobiliaria no vendida aquí).
      const res = await POST(req("POST", { plan: "inmobiliaria" }), ctx());
      expect(res.status).toBe(422);
      expect(dbState.org?.metadata).toBeNull();
    });

    it("con SAAS_PLANS ampliado, Agencia (inmobiliaria) sí se puede conceder", async () => {
      vi.stubEnv("SAAS_PLANS", "basic,pro,inmobiliaria");
      const res = await POST(req("POST", { plan: "inmobiliaria" }), ctx());
      expect(res.status).toBe(200);
      const body = (await res.json()) as { billing: { plan: string } };
      expect(body.billing.plan).toBe("inmobiliaria");
    });

    it("un valor de plan inválido se rechaza con 422", async () => {
      const res = await POST(req("POST", { plan: "enterprise" }), ctx());
      expect(res.status).toBe(422);
    });

    it("negocio inexistente → 404", async () => {
      dbState.org = null;
      const res = await POST(req("POST", { plan: "pro" }), ctx("org_missing"));
      expect(res.status).toBe(404);
    });

    describe("resguardo de Stripe vigente", () => {
      beforeEach(() => {
        // Agencia (inmobiliaria) es el plan que se concede en estas pruebas —
        // hay que habilitarlo explícitamente, igual que en producción.
        vi.stubEnv("SAAS_PLANS", "basic,pro,inmobiliaria");
        dbState.org!.metadata = JSON.stringify({
          allok: { billing: { plan: "pro", status: "active", subscriptionId: "sub_123" } },
        });
      });

      it("no pisa en silencio una suscripción de Stripe activa (409, sin escribir)", async () => {
        const res = await POST(req("POST", { plan: "inmobiliaria" }), ctx());
        expect(res.status).toBe(409);
        expect(dbState.org?.metadata).toContain("sub_123");
        expect(dbState.org?.metadata).toContain('"plan":"pro"');
      });

      it("con confirmOverrideStripe:true sí reemplaza el plan", async () => {
        const res = await POST(req("POST", { plan: "inmobiliaria", confirmOverrideStripe: true }), ctx());
        expect(res.status).toBe(200);
        const body = (await res.json()) as { billing: { plan: string; subscriptionId: string | null } };
        expect(body.billing.plan).toBe("inmobiliaria");
        // El patch de la concesión no toca subscriptionId: Stripe sigue de su lado.
        expect(body.billing.subscriptionId).toBe("sub_123");
      });
    });
  });

  describe("quitar un plan", () => {
    beforeEach(() => {
      dbState.org!.metadata = JSON.stringify({
        allok: {
          billing: {
            plan: "pro",
            status: "active",
            source: "manual_2026-09-01",
            grantedBy: "admin@allok.fun",
            grantedAt: "2026-09-01T00:00:00.000Z",
          },
        },
      });
    });

    it("pasa el estado a canceled y conserva plan/fuente/quién lo concedió", async () => {
      const res = await DELETE(req("DELETE", {}), ctx());
      expect(res.status).toBe(200);
      const body = (await res.json()) as { billing: Record<string, unknown> };
      expect(body.billing).toMatchObject({
        plan: "pro",
        status: "canceled",
        source: "manual_2026-09-01",
        grantedBy: "admin@allok.fun",
      });
      expect(dbState.auditRows.at(-1)).toMatchObject({ action: "revoke_plan", organizationId: ORG_ID });
    });

    it("es idempotente: quitar un plan ya cancelado no falla", async () => {
      await DELETE(req("DELETE", {}), ctx());
      const res = await DELETE(req("DELETE", {}), ctx());
      expect(res.status).toBe(200);
    });

    it("también respeta el resguardo de Stripe vigente", async () => {
      dbState.org!.metadata = JSON.stringify({
        allok: { billing: { plan: "pro", status: "active", subscriptionId: "sub_999" } },
      });
      const blocked = await DELETE(req("DELETE", {}), ctx());
      expect(blocked.status).toBe(409);

      const confirmed = await DELETE(req("DELETE", { confirmOverrideStripe: true }), ctx());
      expect(confirmed.status).toBe(200);
      const body = (await confirmed.json()) as { billing: { status: string } };
      expect(body.billing.status).toBe("canceled");
    });

    it("un no-admin no puede quitar el plan (404, sin cambios)", async () => {
      authState.session = { user: { id: "user_x", email: "cliente@allok.fun", name: "Cliente" } };
      const res = await DELETE(req("DELETE", {}), ctx());
      expect(res.status).toBe(404);
      expect(dbState.org?.metadata).toContain('"status":"active"');
    });
  });
});

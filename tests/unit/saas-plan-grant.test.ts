import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Alta/baja manual de plan (`POST`/`DELETE /api/saas/businesses/[id]/plan`):
 * el respaldo de "paga por link o transferencia" a la concesión que hoy se
 * hace con SQL a mano en producción (specs/018). Se prueba la ruta completa
 * (no solo `grantSaaSPlan`/`revokeSaaSPlan`) porque la autorización y la
 * auditoría viven alrededor de la lógica de negocio.
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

import { DELETE, POST } from "@/app/api/saas/businesses/[id]/plan/route";

const ADMIN = { user: { id: "user_admin", email: "admin@allok.fun", name: "Admin" } };
const ORG_ID = "org_1";

function ctx(id = ORG_ID) {
  return { params: Promise.resolve({ id }) };
}

function req(method: "POST" | "DELETE", body: unknown, contentType: string | null = "application/json"): Request {
  return new Request(`http://localhost/api/saas/businesses/${ORG_ID}/plan`, {
    method,
    headers: contentType ? { "content-type": contentType } : {},
    body: JSON.stringify(body),
  });
}

function auditDetail(row: AuditRow | undefined): Record<string, unknown> {
  return row?.detail ? (JSON.parse(row.detail) as Record<string, unknown>) : {};
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

  describe("validación del body", () => {
    it("sin Content-Type: application/json, 415", async () => {
      const res = await POST(req("POST", { plan: "pro" }, "text/plain"), ctx());
      expect(res.status).toBe(415);
      expect(dbState.auditRows).toEqual([]);
    });

    it("una clave extra en el body se rechaza (schema estricto)", async () => {
      const res = await POST(req("POST", { plan: "pro", extra: "nope" }), ctx());
      expect(res.status).toBe(422);
    });

    it("un valor de plan inválido se rechaza con 422", async () => {
      const res = await POST(req("POST", { plan: "enterprise" }), ctx());
      expect(res.status).toBe(422);
    });
  });

  describe("conceder un plan", () => {
    it("actualiza la metadata, dejando plan/estado/fuente/quién y cuándo, y audita con la organización y el detalle", async () => {
      const res = await POST(req("POST", { plan: "pro" }), ctx());
      expect(res.status).toBe(200);
      const body = (await res.json()) as { billing: Record<string, unknown> };
      expect(body.billing).toMatchObject({ plan: "pro", status: "active", grantedBy: "admin@allok.fun" });
      expect(body.billing.source).toMatch(/^manual_\d{4}-\d{2}-\d{2}$/);
      expect(typeof body.billing.grantedAt).toBe("string");
      expect(body.billing.history).toMatchObject([{ action: "grant", plan: "pro", by: "admin@allok.fun" }]);

      expect(dbState.auditRows).toHaveLength(1);
      expect(dbState.auditRows[0]).toMatchObject({ userId: "user_admin", action: "grant_plan", organizationId: ORG_ID });
      expect(auditDetail(dbState.auditRows[0])).toMatchObject({ plan: "pro", confirmOverrideStripe: false, result: "ok" });
    });

    it("es idempotente: repetirlo confirma el mismo plan sin romper nada, y el historial no pasa de 10", async () => {
      for (let i = 0; i < 12; i++) {
        await POST(req("POST", { plan: "pro" }), ctx());
      }
      const res = await POST(req("POST", { plan: "pro" }), ctx());
      expect(res.status).toBe(200);
      const body = (await res.json()) as { billing: { history: unknown[] } };
      expect(dbState.auditRows).toHaveLength(13);
      expect(body.billing.history).toHaveLength(10);
    });

    it("Agencia (inmobiliaria) se puede conceder sin necesidad de SAAS_PLANS — eso solo gobierna checkout/registro", async () => {
      // SAAS_PLANS no está configurado (default basic,pro) y aun así el admin puede concederlo.
      const res = await POST(req("POST", { plan: "inmobiliaria" }), ctx());
      expect(res.status).toBe(200);
      const body = (await res.json()) as { billing: { plan: string } };
      expect(body.billing.plan).toBe("inmobiliaria");
    });

    it("negocio inexistente → 404, y NO se escribe auditoría (nada que auditar)", async () => {
      dbState.org = null;
      const res = await POST(req("POST", { plan: "pro" }), ctx("org_missing"));
      expect(res.status).toBe(404);
      expect(dbState.auditRows).toEqual([]);
    });

    describe("resguardo de Stripe vigente", () => {
      beforeEach(() => {
        dbState.org!.metadata = JSON.stringify({
          allok: { billing: { plan: "pro", status: "active", customerId: "cus_1", subscriptionId: "sub_123" } },
        });
      });

      it("no pisa en silencio una suscripción de Stripe activa (409, sin escribir), pero sí audita el intento bloqueado", async () => {
        const res = await POST(req("POST", { plan: "inmobiliaria" }), ctx());
        expect(res.status).toBe(409);
        expect(dbState.org?.metadata).toContain("sub_123");
        expect(dbState.org?.metadata).toContain('"plan":"pro"');
        expect(dbState.auditRows).toHaveLength(1);
        expect(auditDetail(dbState.auditRows[0])).toMatchObject({ result: "stripe_subscription_active" });
      });

      it("con confirmOverrideStripe:true desengancha la suscripción (no la cancela en Stripe): subscriptionId/priceId/currentPeriodEnd a null, customerId se conserva, detachedSubscriptionId guarda la vieja", async () => {
        const res = await POST(req("POST", { plan: "inmobiliaria", confirmOverrideStripe: true }), ctx());
        expect(res.status).toBe(200);
        const body = (await res.json()) as {
          billing: {
            plan: string;
            subscriptionId: string | null;
            customerId: string | null;
            detachedSubscriptionId: string | null;
          };
        };
        expect(body.billing.plan).toBe("inmobiliaria");
        expect(body.billing.subscriptionId).toBeNull();
        expect(body.billing.customerId).toBe("cus_1");
        expect(body.billing.detachedSubscriptionId).toBe("sub_123");
        expect(auditDetail(dbState.auditRows[0])).toMatchObject({ confirmOverrideStripe: true, result: "ok" });
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

    it("sin Content-Type: application/json, 415", async () => {
      const res = await DELETE(req("DELETE", {}, "text/plain"), ctx());
      expect(res.status).toBe(415);
    });

    it("una clave extra en el body se rechaza (schema estricto)", async () => {
      const res = await DELETE(req("DELETE", { confirmOverrideStripe: true, extra: 1 }), ctx());
      expect(res.status).toBe(422);
    });

    it("pasa el estado a canceled, conserva plan/fuente/quién lo concedió, y deja quién/cuándo lo quitó", async () => {
      const res = await DELETE(req("DELETE", {}), ctx());
      expect(res.status).toBe(200);
      const body = (await res.json()) as { billing: Record<string, unknown> };
      expect(body.billing).toMatchObject({
        plan: "pro",
        status: "canceled",
        source: "manual_2026-09-01",
        grantedBy: "admin@allok.fun",
        revokedBy: "admin@allok.fun",
      });
      expect(typeof body.billing.revokedAt).toBe("string");
      expect(body.billing.history).toMatchObject([{ action: "revoke", plan: "pro", by: "admin@allok.fun" }]);
      expect(dbState.auditRows.at(-1)).toMatchObject({ action: "revoke_plan", organizationId: ORG_ID });
      expect(auditDetail(dbState.auditRows.at(-1))).toMatchObject({ result: "ok" });
    });

    it("es idempotente: quitar un plan ya cancelado no falla", async () => {
      await DELETE(req("DELETE", {}), ctx());
      const res = await DELETE(req("DELETE", {}), ctx());
      expect(res.status).toBe(200);
    });

    it("negocio inexistente → 404 sin auditar", async () => {
      dbState.org = null;
      const res = await DELETE(req("DELETE", {}), ctx("org_missing"));
      expect(res.status).toBe(404);
      expect(dbState.auditRows).toEqual([]);
    });

    it("también respeta el resguardo de Stripe vigente, y confirmado desengancha igual que al conceder", async () => {
      dbState.org!.metadata = JSON.stringify({
        allok: { billing: { plan: "pro", status: "active", customerId: "cus_1", subscriptionId: "sub_999" } },
      });
      const blocked = await DELETE(req("DELETE", {}), ctx());
      expect(blocked.status).toBe(409);

      const confirmed = await DELETE(req("DELETE", { confirmOverrideStripe: true }), ctx());
      expect(confirmed.status).toBe(200);
      const body = (await confirmed.json()) as {
        billing: { status: string; subscriptionId: string | null; detachedSubscriptionId: string | null };
      };
      expect(body.billing.status).toBe("canceled");
      expect(body.billing.subscriptionId).toBeNull();
      expect(body.billing.detachedSubscriptionId).toBe("sub_999");
    });

    it("un no-admin no puede quitar el plan (404, sin cambios)", async () => {
      authState.session = { user: { id: "user_x", email: "cliente@allok.fun", name: "Cliente" } };
      const res = await DELETE(req("DELETE", {}), ctx());
      expect(res.status).toBe(404);
      expect(dbState.org?.metadata).toContain('"status":"active"');
    });
  });
});

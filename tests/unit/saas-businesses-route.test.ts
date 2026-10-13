import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Alta admin (`POST /api/saas/businesses`): la dirección se valida antes de
 * crear la cuenta y el plan puede quedar activo en el mismo paso.
 */

type FakeSession = { user: { id: string; email: string; name: string } } | null;
const state = vi.hoisted(() => ({
  session: null as FakeSession,
  takenSlugs: [] as string[],
  orgSlug: "condominio-santorini" as string,
  signUps: [] as Array<{ name: string; email: string }>,
  slugUpdates: [] as string[],
  grants: [] as Array<{ organizationId: string; plan: string }>,
  // El mock de drizzle no ve el valor del where: el test fija qué dirección
  // se está consultando.
  pendingSlugCheck: null as string | null,
}));

vi.mock("@/lib/auth", () => ({
  getAuth: () => ({
    api: {
      getSession: async () => state.session,
      signUpEmail: async ({ body }: { body: { name: string; email: string } }) => {
        state.signUps.push({ name: body.name, email: body.email });
        return { user: { id: "user_new" } };
      },
    },
  }),
}));

vi.mock("@/server/saas/admin", () => ({
  grantSaaSPlan: async (params: { organizationId: string; plan: string }) => {
    state.grants.push({ organizationId: params.organizationId, plan: params.plan });
    return { ok: true, billing: {} };
  },
}));

vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  function selectChain() {
    const c: Record<string, unknown> = {};
    let joined = false;
    for (const m of ["from", "where"]) c[m] = () => c;
    c.innerJoin = () => { joined = true; return c; };
    c.limit = () => {
      if (joined) return Promise.resolve([{ id: "org_new", slug: state.orgSlug }]);
      // slugTaken(): la consulta no trae join.
      return Promise.resolve(state.pendingSlugCheck && state.takenSlugs.includes(state.pendingSlugCheck) ? [{ id: "org_other" }] : []);
    };
    return c;
  }
  return {
    ...actual,
    getDb: () => ({
      select: () => selectChain(),
      update: () => ({
        set: (values: { slug: string }) => ({
          where: async () => { state.slugUpdates.push(values.slug); state.orgSlug = values.slug; },
        }),
      }),
    }),
  };
});

import { POST } from "@/app/api/saas/businesses/route";

const ADMIN = { user: { id: "user_admin", email: "admin@allok.fun", name: "Admin" } };

function req(body: unknown): Request {
  return new Request("http://crm.localhost:3000/api/saas/businesses", {
    method: "POST",
    headers: { "content-type": "application/json", host: "crm.localhost:3000" },
    body: JSON.stringify(body),
  });
}

const base = { name: "Condominio Santorini", email: "sergio@samer.bo", password: "temporal123" };

describe("Alta admin de un negocio", () => {
  beforeEach(() => {
    vi.stubEnv("ALLOK_SAAS_MODE", "true");
    vi.stubEnv("ALLOK_ADMIN_EMAILS", "admin@allok.fun");
    vi.stubEnv("SAAS_PLANS", "inmobiliaria");
    state.session = ADMIN;
    state.takenSlugs = [];
    state.orgSlug = "condominio-santorini";
    state.signUps = [];
    state.slugUpdates = [];
    state.grants = [];
    state.pendingSlugCheck = null;
  });
  afterEach(() => vi.unstubAllEnvs());

  it("sin sesión de admin, 404 y no crea nada", async () => {
    state.session = { user: { id: "u", email: "otro@x.com", name: "Otro" } };
    const res = await POST(req({ ...base, slug: "santorini" }));
    expect(res.status).toBe(404);
    expect(state.signUps).toEqual([]);
  });

  it("deja el negocio en la dirección que eligió el admin y con el plan activo", async () => {
    state.pendingSlugCheck = "santorini";
    const res = await POST(req({ ...base, slug: " Santorini ", activarPlan: true }));
    expect(res.status).toBe(200);
    const payload = (await res.json()) as { url: string; plan: string; mensaje: string };
    expect(state.slugUpdates).toEqual(["santorini"]);
    expect(payload.url).toBe("http://santorini.localhost:3000");
    expect(state.grants).toEqual([{ organizationId: "org_new", plan: "inmobiliaria" }]);
    expect(payload.plan).toBe("inmobiliaria");
    expect(payload.mensaje).toContain("santorini.localhost:3000/login");
    expect(payload.mensaje).not.toContain("temporal123");
  });

  it("una dirección ocupada se rechaza ANTES de crear la cuenta", async () => {
    state.takenSlugs = ["santorini"];
    state.pendingSlugCheck = "santorini";
    const res = await POST(req({ ...base, slug: "santorini" }));
    expect(res.status).toBe(409);
    expect(((await res.json()) as { field: string }).field).toBe("slug");
    expect(state.signUps).toEqual([]);
  });

  it("una dirección reservada se rechaza sin crear nada", async () => {
    const res = await POST(req({ ...base, slug: "admin" }));
    expect(res.status).toBe(422);
    expect(state.signUps).toEqual([]);
  });

  it("sin activarPlan, no concede plan", async () => {
    const res = await POST(req({ ...base }));
    expect(res.status).toBe(200);
    expect(state.grants).toEqual([]);
    expect(((await res.json()) as { plan: string | null }).plan).toBeNull();
  });
});

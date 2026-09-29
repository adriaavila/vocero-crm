import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `POST /api/whatsapp/embedded-signup/complete` — redirectTo (item 3 del
 * review): tenantOrigin SOLO en SaaS; fuera de SaaS, appOrigin() (una
 * instancia dedicada no tiene subdominio por inquilino).
 */

const STATE_CONTEXT = { orgId: "org_1", userId: "user_1", mode: "coexistence" as const };

vi.mock("@/server/agencia/whatsapp-signup/state", () => ({
  readStateCookie: () => "cookie-state",
  verifySignupState: () => STATE_CONTEXT,
  buildClearStateCookieHeader: () => "cleared",
}));

vi.mock("@/server/agencia/whatsapp-signup/auth", () => ({
  isStillOwner: async () => true,
}));

vi.mock("@/lib/auth", () => ({
  getAuth: () => ({
    api: { getSession: async () => ({ user: { id: "user_1" } }) },
  }),
}));

const runEmbeddedSignupCompletion = vi.fn();
vi.mock("@/server/agencia/whatsapp-signup/complete", () => ({ runEmbeddedSignupCompletion }));

let saasMode = false;
vi.mock("@/lib/tenant-host", () => ({ isAllokSaaSMode: () => saasMode }));

vi.mock("@/server/saas/billing", () => ({
  appOrigin: () => "http://localhost:3311",
  tenantOrigin: (slug: string) => `https://${slug}.allok.fun`,
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve([{ slug: "acme" }]),
        }),
      }),
    }),
  }),
  schema: { organization: { id: "id", slug: "slug" } },
}));

vi.mock("@/lib/env", () => ({
  getEnv: () => ({ META_APP_SECRET: "secret" }),
  isEmbeddedSignupConfigured: () => true,
}));

function request(): Request {
  return new Request("http://localhost:3311/api/whatsapp/embedded-signup/complete", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: "wa_embedded_signup_state=cookie-state" },
    body: JSON.stringify({ code: "c", state: "cookie-state", mode: "coexistence" }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  saasMode = false;
  runEmbeddedSignupCompletion.mockResolvedValue({
    ok: true,
    displayPhoneNumber: "+52 55 0000 0000",
    verifiedName: "Negocio",
    mode: "coexistence",
  });
});

describe("redirectTo", () => {
  it("fuera de SaaS: usa appOrigin() (una instancia dedicada no tiene subdominio)", async () => {
    saasMode = false;
    const { POST } = await import("@/app/api/whatsapp/embedded-signup/complete/route");
    const response = await POST(request());
    const body = await response.json();
    expect(body.redirectTo).toBe("http://localhost:3311/settings/whatsapp?connected=1");
  });

  it("en SaaS: usa tenantOrigin(slug) del negocio", async () => {
    saasMode = true;
    const { POST } = await import("@/app/api/whatsapp/embedded-signup/complete/route");
    const response = await POST(request());
    const body = await response.json();
    expect(body.redirectTo).toBe("https://acme.allok.fun/settings/whatsapp?connected=1");
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * En admin.allok.fun no hay organización: cualquier pantalla de (app), incluida
 * /overview a donde empuja el login, debe ir a /admin en vez de fallar y volver
 * a /login.
 */

const host = vi.hoisted(() => ({ value: "admin.allok.fun" }));
const requireSession = vi.hoisted(() => vi.fn());

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ host: host.value }),
  cookies: async () => ({ get: () => undefined }),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`);
  },
}));
vi.mock("@/lib/auth/session", () => ({
  requireSession,
  SaaSMemberPlanRequiredError: class extends Error {},
  UnauthorizedError: class extends Error {},
}));

const { default: AppLayout } = await import("@/app/(app)/layout");

afterEach(() => {
  vi.unstubAllEnvs();
  requireSession.mockReset();
});

describe("(app) layout en el host admin", () => {
  it("redirige a /admin sin pedir sesión de organización", async () => {
    vi.stubEnv("ALLOK_SAAS_MODE", "true");
    vi.stubEnv("ALLOK_ROOT_DOMAIN", "allok.fun");
    await expect(AppLayout({ children: null })).rejects.toThrow("NEXT_REDIRECT /admin");
    expect(requireSession).not.toHaveBeenCalled();
  });
});

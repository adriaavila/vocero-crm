import { afterEach, describe, expect, it, vi } from "vitest";

/** FR-060/FR-081: registro cerrado tras la 1ª organización, salvo escape. */

let orgCount = 0;

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => ({
      from: () => Promise.resolve([{ n: orgCount }]),
    }),
  }),
  schema: { organization: {} },
}));

import { isPublicSignupAllowed } from "@/server/auth/registration";

afterEach(() => vi.unstubAllEnvs());

describe("registro público cerrado", () => {
  it("instancia vacía → registro permitido (primer usuario)", async () => {
    orgCount = 0;
    vi.stubEnv("ALLOW_SIGNUP", "");
    expect(await isPublicSignupAllowed()).toBe(true);
  });

  it("ya existe una organización → cerrado", async () => {
    orgCount = 1;
    vi.stubEnv("ALLOW_SIGNUP", "");
    expect(await isPublicSignupAllowed()).toBe(false);
  });

  it("escape ALLOW_SIGNUP=true → permitido aunque exista organización", async () => {
    orgCount = 1;
    vi.stubEnv("ALLOW_SIGNUP", "true");
    expect(await isPublicSignupAllowed()).toBe(true);
  });

  it("otros valores del escape NO abren el registro", async () => {
    orgCount = 1;
    vi.stubEnv("ALLOW_SIGNUP", "1");
    expect(await isPublicSignupAllowed()).toBe(false);
  });

  it("SaaS con autoservicio apagado → cerrado aunque no haya organizaciones", async () => {
    orgCount = 0;
    vi.stubEnv("ALLOK_SAAS_MODE", "true");
    vi.stubEnv("ALLOW_SIGNUP", "true");
    expect(await isPublicSignupAllowed()).toBe(false);
  });
});

describe("admins de allok", () => {
  it("sólo los correos de ALLOK_ADMIN_EMAILS, sin importar mayúsculas", async () => {
    const { isSaaSAdminEmail } = await import("@/lib/tenant-host");
    vi.stubEnv("ALLOK_ADMIN_EMAILS", "a@allok.fun, B@allok.fun");
    expect(isSaaSAdminEmail("b@ALLOK.fun")).toBe(true);
    expect(isSaaSAdminEmail("cliente@negocio.com")).toBe(false);
    expect(isSaaSAdminEmail(null)).toBe(false);
  });
});

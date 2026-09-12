import { afterEach, describe, expect, it, vi } from "vitest";
import { isSaaSAdminEmail } from "../../src/server/saas/admin";

describe("Allok SaaS admin", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("solo acepta emails explícitamente configurados, ignorando mayúsculas y espacios", () => {
    vi.stubEnv("ALLOK_ADMIN_EMAILS", " soporte@allok.fun, owner@allok.fun ");
    expect(isSaaSAdminEmail("SOPORTE@ALLOK.FUN")).toBe(true);
    expect(isSaaSAdminEmail("cliente@allok.fun")).toBe(false);
  });
});

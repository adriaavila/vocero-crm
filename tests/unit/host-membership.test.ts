import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  rows: [] as { organizationId: string; role: string }[],
}));

vi.mock("@/lib/db", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/db")>();
  const fakeDb = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => state.rows,
        }),
      }),
    }),
  };
  return { ...original, getDb: () => fakeDb };
});

import { resolveMembershipForHost } from "@/server/auth/on-signup";

afterEach(() => {
  state.rows = [];
  vi.unstubAllEnvs();
});

describe("membresía en el host de aplicación SaaS", () => {
  it("no adivina una organización cuando la cuenta tiene varias", async () => {
    vi.stubEnv("ALLOK_SAAS_MODE", "true");
    state.rows = [
      { organizationId: "org_a", role: "owner" },
      { organizationId: "org_b", role: "owner" },
    ];

    await expect(resolveMembershipForHost("user_1", "app.allok.fun")).resolves.toBeNull();
  });

  it("permite el puente de checkout con la única membresía", async () => {
    vi.stubEnv("ALLOK_SAAS_MODE", "true");
    state.rows = [{ organizationId: "org_a", role: "owner" }];

    await expect(resolveMembershipForHost("user_1", "app.allok.fun")).resolves.toEqual(state.rows[0]);
  });
});

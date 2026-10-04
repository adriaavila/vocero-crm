import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let profile: Record<string, unknown> = {};
let pro = false;

const chain: Record<string, unknown> = {
  then: (resolve: (value: unknown[]) => unknown) => Promise.resolve([profile]).then(resolve),
};
for (const step of ["from", "where", "limit"]) chain[step] = () => chain;

vi.mock("@/lib/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db")>()),
  getDb: () => ({ select: () => chain }),
}));
vi.mock("@/server/agencia/entitlements", () => ({ hasSaaSPlan: async () => pro }));

import { canAgentRespondNow } from "@/server/business-hours";

const MON_9_TO_18 = { mon: [{ start: "09:00", end: "18:00" }] };
const INSIDE = new Date("2026-09-07T15:00:00Z"); // Mon 09:00 America/Mexico_City
const OUTSIDE = new Date("2026-09-08T05:00:00Z"); // Mon 23:00

describe("canAgentRespondNow with responseMode all_day", () => {
  beforeEach(() => {
    vi.stubEnv("ALLOK_SAAS_MODE", "true");
    profile = { businessHours: MON_9_TO_18, businessTimezone: "America/Mexico_City", responseMode: "all_day" };
  });
  afterEach(() => vi.unstubAllEnvs());

  it("Esencial answers outside the weekly hours (all_day degrades to outside_hours)", async () => {
    pro = false;
    expect(await canAgentRespondNow("org_1", OUTSIDE)).toBe(true);
  });

  it("Esencial stays quiet inside the weekly hours", async () => {
    pro = false;
    expect(await canAgentRespondNow("org_1", INSIDE)).toBe(false);
  });

  it("Completo answers all day, inside and outside the hours", async () => {
    pro = true;
    expect(await canAgentRespondNow("org_1", INSIDE)).toBe(true);
    expect(await canAgentRespondNow("org_1", OUTSIDE)).toBe(true);
  });
});

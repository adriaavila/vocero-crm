import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let metadata = "{}";
let aiReplies = 0;
vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve([{ metadata }]) }) }) }),
    execute: () => Promise.resolve([{ n: aiReplies }]),
  }),
  schema: { organization: { id: "id", metadata: "metadata" } },
}));

const { trialAiQuotaReached } = await import("@/server/agencia/entitlements");

const trial = (billing: Record<string, unknown>) =>
  JSON.stringify({
    allok: {
      billing: {
        plan: "pro",
        status: "trialing",
        source: "self_serve_trial",
        subscriptionId: null,
        currentPeriodEnd: new Date(Date.now() + 86400000).toISOString(),
        ...billing,
      },
    },
  });

describe("tope de 300 respuestas de IA en la prueba", () => {
  beforeEach(() => {
    process.env.ALLOK_SAAS_MODE = "true";
  });
  afterEach(() => {
    delete process.env.ALLOK_SAAS_MODE;
  });

  it("frena al llegar a 300, no antes", async () => {
    metadata = trial({});
    aiReplies = 299;
    expect(await trialAiQuotaReached("org_1")).toBe(false);
    aiReplies = 300;
    expect(await trialAiQuotaReached("org_1")).toBe(true);
  });

  it("no aplica a quien ya paga", async () => {
    metadata = trial({ subscriptionId: "sub_1", status: "active", source: "stripe" });
    aiReplies = 5000;
    expect(await trialAiQuotaReached("org_1")).toBe(false);
  });
});

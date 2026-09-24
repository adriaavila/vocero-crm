import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `POST /api/provision/smoke-test` runs at the end of the allok.fun handover,
 * after credentials and webhook are already live. Without a test number there
 * is nobody to message: it must report a skipped success, never an error that
 * fails (and retries) the customer's handover.
 */

const { callGraphSend } = vi.hoisted(() => ({ callGraphSend: vi.fn() }));

vi.mock("@/lib/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db")>()),
  getDb: () => {
    throw new Error("a skipped smoke test must not touch the database");
  },
}));
vi.mock("@/server/inbox/send", () => ({ callGraphSend }));

import { resetEnvCacheForTests } from "@/lib/env";
import { POST } from "@/app/api/provision/smoke-test/route";

const SECRET = "un-secreto-suficientemente-largo";

function smokeTest(authorization: string | null) {
  return POST(
    new Request("http://localhost/api/provision/smoke-test", {
      method: "POST",
      headers: authorization ? { authorization } : {},
      body: JSON.stringify({ organization_id: "org_1" }),
    })
  );
}

describe("provision smoke test without WHATSAPP_SMOKE_TEST_TO", () => {
  beforeEach(() => {
    vi.stubEnv("APP_BASE_URL", "http://localhost:3000");
    vi.stubEnv("DATABASE_URL", "postgresql://t:t@localhost:5432/t");
    vi.stubEnv("BETTER_AUTH_SECRET", "secret-de-test-suficiente");
    vi.stubEnv("ENCRYPTION_KEY", Buffer.alloc(32, 8).toString("base64"));
    vi.stubEnv("META_WEBHOOK_VERIFY_TOKEN", "verify-test");
    vi.stubEnv("PROVISION_API_KEY", SECRET);
    vi.stubEnv("WHATSAPP_SMOKE_TEST_TO", "");
    resetEnvCacheForTests();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetEnvCacheForTests();
  });

  it("returns a skipped success without calling Meta", async () => {
    const response = await smokeTest(`Bearer ${SECRET}`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, skipped: true });
    expect(callGraphSend).not.toHaveBeenCalled();
  });

  it("still rejects callers without the provision secret", async () => {
    expect((await smokeTest(null)).status).toBe(401);
  });
});

import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({
  getEnv: () => ({ NODE_ENV: "production", META_APP_SECRET: undefined }),
}));
vi.mock("@/lib/db", () => ({
  getDb: () => ({ execute: vi.fn() }),
}));

import { GET } from "@/app/api/health/route";

describe("GET /api/health", () => {
  it("no declara saludable una producción sin firma de Meta", async () => {
    const response = await GET();
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code: "webhook_unconfigured" },
    });
  });
});

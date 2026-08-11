import { afterEach, describe, expect, it, vi } from "vitest";
import { phoneToChatId, startWahaSession, WahaError } from "@/server/lab/waha";

afterEach(() => vi.unstubAllGlobals());

describe("WAHA live test", () => {
  it("convierte el número visible de Meta al chat de WAHA", () => {
    expect(phoneToChatId("+58 412-555-0199")).toBe("584125550199@c.us");
    expect(() => phoneToChatId("---")).toThrow(WahaError);
  });

  it("reinicia una sesión cuyo QR expiró", async () => {
    vi.stubEnv("APP_BASE_URL", "http://localhost:3000");
    vi.stubEnv("DATABASE_URL", "postgresql://test:test@localhost/test");
    vi.stubEnv("BETTER_AUTH_SECRET", "test-secret-at-least-16");
    vi.stubEnv("ENCRYPTION_KEY", Buffer.alloc(32).toString("base64"));
    vi.stubEnv("META_WEBHOOK_VERIFY_TOKEN", "test-verify-token");
    vi.stubEnv("WAHA_API_URL", "http://waha:3000");
    vi.stubEnv("WAHA_API_KEY", "test-api-key-at-least-16");
    vi.stubEnv("WAHA_SESSION", "vocero-test");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json([{ name: "vocero-test", status: "FAILED" }]))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(Response.json([{ name: "vocero-test", status: "STARTING" }]));
    vi.stubGlobal("fetch", fetchMock);

    await expect(startWahaSession()).resolves.toMatchObject({ status: "STARTING" });
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "http://waha:3000/api/sessions/vocero-test/restart"
    );
  });
});

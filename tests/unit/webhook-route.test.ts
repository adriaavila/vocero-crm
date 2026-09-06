import { beforeEach, describe, expect, it, vi } from "vitest";

const { processMessagesValue } = vi.hoisted(() => ({
  processMessagesValue: vi.fn(),
}));

vi.mock("@/lib/env", () => ({
  getEnv: () => ({
    META_WEBHOOK_VERIFY_TOKEN: "verify-token",
    META_APP_SECRET: undefined,
  }),
  isMockEnabled: () => true,
}));
vi.mock("@/server/inbox/ingest", () => ({
  processMessagesValue,
  processEchoesValue: vi.fn(),
}));
vi.mock("@/server/whatsapp/template-events", () => ({
  processTemplateStatusValue: vi.fn(),
}));

import { POST } from "@/app/api/webhooks/wa/[webhookToken]/route";

const payload = {
  entry: [{ changes: [{ field: "messages", value: {} }] }],
};

describe("POST webhook de WhatsApp", () => {
  beforeEach(() => vi.clearAllMocks());

  it("pide reintento a Meta cuando no logra persistir el evento", async () => {
    processMessagesValue.mockRejectedValueOnce(new Error("db down"));

    const response = await POST(
      new Request("http://localhost/api/webhooks/wa/verify-token", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
      { params: Promise.resolve({ webhookToken: "verify-token" }) }
    );

    expect(response.status).toBe(503);
  });
});

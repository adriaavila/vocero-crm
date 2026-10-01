import { beforeEach, describe, expect, it, vi } from "vitest";

const { processMessagesValue, processHistoryValue, processSmbAppStateSyncValue } = vi.hoisted(() => ({
  processMessagesValue: vi.fn(),
  processHistoryValue: vi.fn(),
  processSmbAppStateSyncValue: vi.fn(),
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
vi.mock("@/server/agencia/whatsapp-signup/history-sync", () => ({
  processHistoryValue,
  processSmbAppStateSyncValue,
}));

import { POST } from "@/app/api/webhooks/wa/[webhookToken]/route";

const payload = {
  entry: [{ changes: [{ field: "messages", value: {} }] }],
};

function post(body: unknown) {
  return POST(
    new Request("http://localhost/api/webhooks/wa/verify-token", {
      method: "POST",
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ webhookToken: "verify-token" }) }
  );
}

describe("POST webhook de WhatsApp", () => {
  beforeEach(() => vi.clearAllMocks());

  it("pide reintento a Meta cuando no logra persistir el evento", async () => {
    processMessagesValue.mockRejectedValueOnce(new Error("db down"));

    const response = await post(payload);

    expect(response.status).toBe(503);
  });

  it("payload mixto: procesa messages ANTES que history, y un error de BD en history igual 503 (Meta reintenta, los inserts son idempotentes)", async () => {
    processMessagesValue.mockResolvedValueOnce(undefined);
    processHistoryValue.mockRejectedValueOnce(new Error("conexión a Postgres perdida"));

    const response = await post({
      entry: [
        {
          changes: [
            { field: "history", value: { metadata: { phone_number_id: "p1" } } },
            { field: "messages", value: { metadata: { phone_number_id: "p1" } } },
          ],
        },
      ],
    });

    // messages se procesó (aunque venía DESPUÉS en el arreglo) antes de que
    // history reventara.
    expect(processMessagesValue).toHaveBeenCalledTimes(1);
    expect(processHistoryValue).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(503);
  });

  it("payload mixto sano: messages y smb_app_state_sync se procesan los dos, 200", async () => {
    processMessagesValue.mockResolvedValueOnce(undefined);
    processSmbAppStateSyncValue.mockResolvedValueOnce({ processed: 1, skipped: 0 });

    const response = await post({
      entry: [
        {
          changes: [
            { field: "messages", value: {} },
            { field: "smb_app_state_sync", value: {} },
          ],
        },
      ],
    });

    expect(processMessagesValue).toHaveBeenCalledTimes(1);
    expect(processSmbAppStateSyncValue).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(200);
  });
});

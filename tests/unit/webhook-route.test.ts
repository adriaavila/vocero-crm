import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryStore, memoryStoreModule } from "./support/memory-raw-event-store";

const { processMessagesValue, processHistoryValue, processSmbAppStateSyncValue, env } = vi.hoisted(() => ({
  processMessagesValue: vi.fn(),
  processHistoryValue: vi.fn(),
  processSmbAppStateSyncValue: vi.fn(),
  env: { META_APP_SECRET: undefined as string | undefined, mock: true },
}));

vi.mock("@/lib/env", () => ({
  getEnv: () => ({
    META_WEBHOOK_VERIFY_TOKEN: "verify-token",
    META_APP_SECRET: env.META_APP_SECRET,
  }),
  isMockEnabled: () => env.mock,
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
// Data spine: el webhook guarda cada cambio crudo; aquí la tabla es una tienda en memoria.
vi.mock("@/server/agencia/raw-events-store", () => memoryStoreModule);
vi.mock("@/server/whatsapp/credentials", () => ({
  getCredentialsByPhoneNumberId: async () => ({ organizationId: "org_1", wabaId: "W", phoneNumberId: "p1" }),
  getCredentialsByWabaId: async () => ({ organizationId: "org_1", wabaId: "W", phoneNumberId: "p1" }),
  getCredentialsByOrg: async () => null,
}));

import { POST } from "@/app/api/webhooks/wa/[webhookToken]/route";

const payload = {
  entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: "p1" } } }] }],
};

function post(body: unknown, opts: { token?: string; signature?: string } = {}) {
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  return POST(
    new Request("http://localhost/api/webhooks/wa/verify-token", {
      method: "POST",
      body: raw,
      headers: opts.signature ? { "x-hub-signature-256": opts.signature } : {},
    }),
    { params: Promise.resolve({ webhookToken: opts.token ?? "verify-token" }) }
  );
}

describe("POST webhook de WhatsApp", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    memoryStore.reset();
    env.META_APP_SECRET = undefined;
    env.mock = true;
  });

  it("pide reintento a Meta cuando no logra persistir el evento", async () => {
    processMessagesValue.mockRejectedValueOnce(new Error("db down"));

    const response = await post(payload);

    expect(response.status).toBe(503);
    expect(memoryStore.rows[0]).toMatchObject({ field: "messages", status: "failed" });
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
            { field: "messages", value: { metadata: { phone_number_id: "p1" } } },
            { field: "smb_app_state_sync", value: { metadata: { phone_number_id: "p1" } } },
          ],
        },
      ],
    });

    expect(processMessagesValue).toHaveBeenCalledTimes(1);
    expect(processSmbAppStateSyncValue).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(200);
  });

  it("cuerpo ilegible con firma válida: 200 como siempre, y queda guardado como `_unparsed`", async () => {
    const response = await post("{roto");

    expect(response.status).toBe(200);
    expect(memoryStore.rows).toHaveLength(1);
    expect(memoryStore.rows[0]).toMatchObject({ field: "_unparsed", status: "failed" });
    expect(processMessagesValue).not.toHaveBeenCalled();
  });
});

describe("POST webhook de WhatsApp: firma", () => {
  const SECRET = "app-secret-de-prueba";
  const sign = (raw: string) => `sha256=${createHmac("sha256", SECRET).update(raw, "utf8").digest("hex")}`;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    memoryStore.reset();
    env.META_APP_SECRET = SECRET;
    env.mock = false;
  });

  it("firma inválida: 401 y NO se guarda ni se procesa nada", async () => {
    const response = await post(payload, { signature: "sha256=" + "0".repeat(64) });

    expect(response.status).toBe(401);
    expect(memoryStore.rows).toHaveLength(0);
    expect(processMessagesValue).not.toHaveBeenCalled();
  });

  it("sin firma: 401 y NO se guarda nada", async () => {
    const response = await post(payload);

    expect(response.status).toBe(401);
    expect(memoryStore.rows).toHaveLength(0);
  });

  it("cuerpo ilegible con firma INVÁLIDA: 401 y tampoco se guarda (solo lo firmado entra)", async () => {
    const response = await post("{roto", { signature: "sha256=" + "1".repeat(64) });

    expect(response.status).toBe(401);
    expect(memoryStore.rows).toHaveLength(0);
  });

  it("token de ruta equivocado: 404 y nada guardado", async () => {
    const raw = JSON.stringify(payload);
    const response = await post(payload, { token: "otro", signature: sign(raw) });

    expect(response.status).toBe(404);
    expect(memoryStore.rows).toHaveLength(0);
  });

  it("firma válida: 200, guardado y procesado", async () => {
    const raw = JSON.stringify(payload);
    processMessagesValue.mockResolvedValueOnce("processed");

    const response = await post(payload, { signature: sign(raw) });

    expect(response.status).toBe(200);
    expect(memoryStore.rows).toHaveLength(1);
    expect(memoryStore.rows[0]).toMatchObject({ status: "processed", organizationId: "org_1" });
  });
});

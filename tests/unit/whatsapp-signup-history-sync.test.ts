import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `history` / `smb_app_state_sync` (server/agencia/whatsapp-signup/
 * history-sync.ts): idempotencia por `wa_message_id`, upsert de nombre sin
 * crear conversación, y que una entrada rota nunca tumba el resto.
 *
 * Ninguno de los dos campos importa `server/events/bus` (publish) ni
 * `server/ai/trigger` (maybeRunAgentTurn) — por construcción del módulo, no
 * hay nada que disparar un turno de agente ni un aviso de "mensaje nuevo".
 */

const getCredentialsByPhoneNumberId = vi.fn();
vi.mock("@/server/whatsapp/credentials", () => ({ getCredentialsByPhoneNumberId }));

const getOrCreateContactByIdentity = vi.fn();
vi.mock("@/server/inbox/identity", () => ({ getOrCreateContactByIdentity }));

const getOrCreateConversation = vi.fn();
vi.mock("@/server/inbox/ingest", () => ({ getOrCreateConversation }));

const insertedIds = new Set<string>();
vi.mock("@/lib/db", () => ({
  getDb: () => ({
    insert: () => ({
      values: (v: { id: string; waMessageId: string }) => ({
        onConflictDoNothing: () => ({
          returning: () => {
            if (insertedIds.has(v.waMessageId)) return Promise.resolve([]);
            insertedIds.add(v.waMessageId);
            return Promise.resolve([{ id: v.id }]);
          },
        }),
      }),
    }),
  }),
  schema: { message: { waMessageId: "wa_message_id", id: "id" } },
}));

const CREDENTIALS = { organizationId: "org_1", phoneNumberId: "phone_1" };

beforeEach(() => {
  vi.clearAllMocks();
  insertedIds.clear();
  getCredentialsByPhoneNumberId.mockResolvedValue(CREDENTIALS);
  getOrCreateContactByIdentity.mockResolvedValue({ contact: { id: "contact_1" } });
  getOrCreateConversation.mockResolvedValue({ id: "conv_1" });
});

describe("processHistoryValue", () => {
  it("inserta los mensajes del hilo, idempotente por wa_message_id", async () => {
    const { processHistoryValue } = await import("@/server/agencia/whatsapp-signup/history-sync");
    const value = {
      metadata: { phone_number_id: "phone_1" },
      history: [
        {
          threads: [
            {
              id: "5215512345678",
              messages: [
                { id: "wamid.h1", from: "5215512345678", timestamp: "1700000000", type: "text", text: { body: "hola" } },
                { id: "wamid.h2", from: "business", timestamp: "1700000100", type: "text", text: { body: "hola, en qué ayudo" } },
              ],
            },
          ],
        },
      ],
    };
    const counts = await processHistoryValue(value);
    expect(counts).toEqual({ processed: 2, skipped: 0 });
    expect(getOrCreateConversation).toHaveBeenCalledTimes(2);
  });

  it("una segunda entrega del MISMO mensaje no lo duplica (idempotencia)", async () => {
    const { processHistoryValue } = await import("@/server/agencia/whatsapp-signup/history-sync");
    const value = {
      metadata: { phone_number_id: "phone_1" },
      history: [
        { threads: [{ id: "5215512345678", messages: [{ id: "wamid.dup", timestamp: "1700000000", type: "text" }] }] },
      ],
    };
    const first = await processHistoryValue(value);
    const second = await processHistoryValue(value);
    expect(first.processed).toBe(1);
    expect(second.processed).toBe(0);
    expect(second.skipped).toBe(1);
  });

  it("un mensaje sin id se descarta sin tumbar el resto del hilo", async () => {
    const { processHistoryValue } = await import("@/server/agencia/whatsapp-signup/history-sync");
    const value = {
      metadata: { phone_number_id: "phone_1" },
      history: [
        {
          threads: [
            {
              id: "5215512345678",
              messages: [
                { timestamp: "1700000000", type: "text" }, // sin id: inválido
                { id: "wamid.ok", timestamp: "1700000000", type: "text" },
              ],
            },
          ],
        },
      ],
    };
    const counts = await processHistoryValue(value);
    expect(counts).toEqual({ processed: 1, skipped: 1 });
  });

  it("un error al resolver el contacto se cuenta como skipped, no lanza", async () => {
    getOrCreateContactByIdentity.mockRejectedValueOnce(new Error("boom"));
    const { processHistoryValue } = await import("@/server/agencia/whatsapp-signup/history-sync");
    const value = {
      metadata: { phone_number_id: "phone_1" },
      history: [{ threads: [{ id: "5215512345678", messages: [{ id: "wamid.err", timestamp: "1700000000", type: "text" }] }] }],
    };
    await expect(processHistoryValue(value)).resolves.toEqual({ processed: 0, skipped: 1 });
  });

  it("sin phone_number_id o sin credenciales, no hace nada (no revienta)", async () => {
    const { processHistoryValue } = await import("@/server/agencia/whatsapp-signup/history-sync");
    expect(await processHistoryValue({})).toEqual({ processed: 0, skipped: 0 });

    getCredentialsByPhoneNumberId.mockResolvedValueOnce(null);
    expect(await processHistoryValue({ metadata: { phone_number_id: "desconocido" } })).toEqual({
      processed: 0,
      skipped: 0,
    });
  });
});

describe("processSmbAppStateSyncValue", () => {
  it("hace upsert de nombre por contacto, y NUNCA crea una conversación", async () => {
    const { processSmbAppStateSyncValue } = await import("@/server/agencia/whatsapp-signup/history-sync");
    const value = {
      metadata: { phone_number_id: "phone_1" },
      state_sync: [{ type: "contact", contact: { phone_number: "5215512345678", full_name: "Cliente Real" } }],
    };
    const counts = await processSmbAppStateSyncValue(value);
    expect(counts).toEqual({ processed: 1, skipped: 0 });
    expect(getOrCreateContactByIdentity).toHaveBeenCalledWith(
      "org_1",
      expect.objectContaining({ profileName: "Cliente Real" })
    );
    expect(getOrCreateConversation).not.toHaveBeenCalled();
  });

  it("entradas sin teléfono o sin nombre se descartan", async () => {
    const { processSmbAppStateSyncValue } = await import("@/server/agencia/whatsapp-signup/history-sync");
    const value = {
      metadata: { phone_number_id: "phone_1" },
      state_sync: [{ contact: { phone_number: "5215512345678" } }, { contact: { full_name: "Sin teléfono" } }],
    };
    const counts = await processSmbAppStateSyncValue(value);
    expect(counts).toEqual({ processed: 0, skipped: 2 });
  });
});

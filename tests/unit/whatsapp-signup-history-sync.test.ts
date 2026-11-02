import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

/**
 * `history` / `smb_app_state_sync` (server/agencia/whatsapp-signup/
 * history-sync.ts): `createdAt` = timestamp real de WhatsApp,
 * `lastMessageAt` solo avanza (GREATEST), lookups una vez por thread, un
 * error de BD real se propaga (no se atrapa), y `smb_app_state_sync` nunca
 * crea ni reactiva contactos.
 *
 * Ninguno de los dos importa `server/events/bus` (publish) ni
 * `server/ai/trigger` (maybeRunAgentTurn) — por construcción del módulo.
 */

const getCredentialsByPhoneNumberId = vi.fn();
vi.mock("@/server/whatsapp/credentials", () => ({ getCredentialsByPhoneNumberId }));

const getOrCreateContactByIdentity = vi.fn();
const isFallbackName = vi.fn();
vi.mock("@/server/inbox/identity", () => ({ getOrCreateContactByIdentity, isFallbackName }));

const getOrCreateConversation = vi.fn();
vi.mock("@/server/inbox/ingest", () => ({ getOrCreateConversation }));

const insertedIds = new Set<string>();
const insertedRows: { id: string; waMessageId: string; createdAt: Date; waTimestamp: Date; origin: string }[] = [];
const conversationUpdates: { id: string; lastMessageAt: unknown }[] = [];
let contactRows: { id: string; archivedAt: Date | null; name: string; phone: string | null }[] = [];

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    insert: () => ({
      values: (v: { id: string; waMessageId: string; createdAt: Date; waTimestamp: Date; origin: string }) => ({
        onConflictDoNothing: () => ({
          returning: () => {
            if (insertedIds.has(v.waMessageId)) return Promise.resolve([]);
            insertedIds.add(v.waMessageId);
            insertedRows.push(v);
            return Promise.resolve([{ id: v.id }]);
          },
        }),
      }),
    }),
    update: () => ({
      set: (patch: { name?: string; lastMessageAt?: unknown }) => ({
        where: () => {
          if ("lastMessageAt" in patch) conversationUpdates.push({ id: "conv_1", lastMessageAt: patch.lastMessageAt });
          if ("name" in patch && contactRows[0]) contactRows[0].name = patch.name as string;
          return Promise.resolve();
        },
      }),
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(contactRows),
        }),
      }),
    }),
  }),
  schema: {
    message: { waMessageId: "wa_message_id", id: "id" },
    contact: { id: "id", organizationId: "organization_id", channel: "channel", waIdentity: "wa_identity" },
    conversation: { id: "id", lastMessageAt: "last_message_at" },
  },
}));

const CREDENTIALS = { organizationId: "org_1", phoneNumberId: "phone_1" };

beforeEach(() => {
  vi.clearAllMocks();
  insertedIds.clear();
  insertedRows.length = 0;
  conversationUpdates.length = 0;
  contactRows = [];
  getCredentialsByPhoneNumberId.mockResolvedValue(CREDENTIALS);
  getOrCreateContactByIdentity.mockResolvedValue({ contact: { id: "contact_1" } });
  getOrCreateConversation.mockResolvedValue({ id: "conv_1" });
  isFallbackName.mockReturnValue(true);
});

describe("processHistoryValue", () => {
  it("createdAt es EXACTAMENTE el timestamp de WhatsApp, no 'ahora'", async () => {
    const { processHistoryValue } = await import("@/server/agencia/whatsapp-signup/history-sync");
    await processHistoryValue({
      metadata: { phone_number_id: "phone_1" },
      history: [
        { threads: [{ id: "5215512345678", messages: [{ id: "wamid.h1", timestamp: "1700000000", type: "text" }] }] },
      ],
    });
    expect(insertedRows).toHaveLength(1);
    const row = insertedRows[0]!;
    expect(row.waTimestamp.getTime()).toBe(1700000000 * 1000);
    expect(row.createdAt.getTime()).toBe(row.waTimestamp.getTime());
    expect(row.origin).toBe("history");
  });

  it("descarta (no inventa 'ahora') un mensaje con timestamp faltante o inválido", async () => {
    const { processHistoryValue } = await import("@/server/agencia/whatsapp-signup/history-sync");
    const counts = await processHistoryValue({
      metadata: { phone_number_id: "phone_1" },
      history: [
        {
          threads: [
            {
              id: "5215512345678",
              messages: [
                { id: "wamid.sin-ts", type: "text" }, // sin timestamp
                { id: "wamid.ts-mala", timestamp: "no-es-un-numero", type: "text" },
                { id: "wamid.ts-cero", timestamp: "0", type: "text" },
                { id: "wamid.ok", timestamp: "1700000000", type: "text" },
              ],
            },
          ],
        },
      ],
    });
    expect(counts).toEqual({ processed: 1, skipped: 3 });
    expect(insertedRows).toHaveLength(1);
  });

  it("lookups de contacto/conversación UNA vez por thread, no por mensaje", async () => {
    const { processHistoryValue } = await import("@/server/agencia/whatsapp-signup/history-sync");
    await processHistoryValue({
      metadata: { phone_number_id: "phone_1" },
      history: [
        {
          threads: [
            {
              id: "5215512345678",
              messages: [
                { id: "wamid.1", timestamp: "1700000000", type: "text" },
                { id: "wamid.2", timestamp: "1700000100", type: "text" },
                { id: "wamid.3", timestamp: "1700000200", type: "text" },
              ],
            },
          ],
        },
      ],
    });
    expect(getOrCreateContactByIdentity).toHaveBeenCalledTimes(1);
    expect(getOrCreateConversation).toHaveBeenCalledTimes(1);
    // Un chat viejo del teléfono nace con la IA apagada.
    expect(getOrCreateConversation).toHaveBeenCalledWith(expect.anything(), expect.anything(), { aiEnabled: false });
  });

  it("lastMessageAt de la conversación avanza al máximo timestamp del thread (GREATEST, no se pisa con uno viejo)", async () => {
    const { processHistoryValue } = await import("@/server/agencia/whatsapp-signup/history-sync");
    await processHistoryValue({
      metadata: { phone_number_id: "phone_1" },
      history: [
        {
          threads: [
            {
              id: "5215512345678",
              messages: [
                { id: "wamid.a", timestamp: "1700000200", type: "text" },
                { id: "wamid.b", timestamp: "1700000000", type: "text" }, // más viejo, no debe ganar
              ],
            },
          ],
        },
      ],
    });
    expect(conversationUpdates).toHaveLength(1);
    // El valor se envuelve en SQL GREATEST(...) — solo confirmamos que SE
    // actualiza con el máximo del thread, no con el último mensaje procesado.
    const { sql, params } = new PgDialect().sqlToQuery(conversationUpdates[0]!.lastMessageAt as SQL);
    expect(sql.toLowerCase()).toContain("greatest");
    // postgres-js no serializa un Date crudo en un parámetro de tipo
    // desconocido (prod: "The string argument must be of type string…
    // Received an instance of Date"): va como texto ISO con cast.
    expect(params.some((p) => p instanceof Date)).toBe(false);
    expect(params).toContain(new Date(1700000200 * 1000).toISOString());
    expect(sql).toMatch(/\$\d+::timestamp\)$/);
  });

  it("un error de base de datos real se propaga (no se atrapa) — Meta debe reintentar", async () => {
    getOrCreateConversation.mockRejectedValueOnce(new Error("conexión a Postgres perdida"));
    const { processHistoryValue } = await import("@/server/agencia/whatsapp-signup/history-sync");
    await expect(
      processHistoryValue({
        metadata: { phone_number_id: "phone_1" },
        history: [{ threads: [{ id: "5215512345678", messages: [{ id: "wamid.x", timestamp: "1700000000", type: "text" }] }] }],
      })
    ).rejects.toThrow("conexión a Postgres perdida");
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
  it("actualiza el nombre de un contacto EXISTENTE (con nombre de respaldo) y nunca crea uno nuevo", async () => {
    contactRows = [{ id: "contact_1", archivedAt: null, name: "Contacto de WhatsApp", phone: "5215512345678" }];
    isFallbackName.mockReturnValue(true);
    const { processSmbAppStateSyncValue } = await import("@/server/agencia/whatsapp-signup/history-sync");
    const counts = await processSmbAppStateSyncValue({
      metadata: { phone_number_id: "phone_1" },
      state_sync: [{ type: "contact", contact: { phone_number: "5215512345678", full_name: "Cliente Real" } }],
    });
    expect(counts).toEqual({ processed: 1, skipped: 0 });
    expect(contactRows[0]!.name).toBe("Cliente Real");
    expect(getOrCreateContactByIdentity).not.toHaveBeenCalled();
    expect(getOrCreateConversation).not.toHaveBeenCalled();
  });

  it("sin un contacto existente para ese teléfono, se descarta (nunca lo crea)", async () => {
    contactRows = [];
    const { processSmbAppStateSyncValue } = await import("@/server/agencia/whatsapp-signup/history-sync");
    const counts = await processSmbAppStateSyncValue({
      metadata: { phone_number_id: "phone_1" },
      state_sync: [{ contact: { phone_number: "5215512345678", full_name: "Cliente Real" } }],
    });
    expect(counts).toEqual({ processed: 0, skipped: 1 });
  });

  it("un contacto archivado se deja archivado (nunca lo reactiva)", async () => {
    contactRows = [{ id: "contact_1", archivedAt: new Date(), name: "Contacto de WhatsApp", phone: "5215512345678" }];
    const { processSmbAppStateSyncValue } = await import("@/server/agencia/whatsapp-signup/history-sync");
    const counts = await processSmbAppStateSyncValue({
      metadata: { phone_number_id: "phone_1" },
      state_sync: [{ contact: { phone_number: "5215512345678", full_name: "Cliente Real" } }],
    });
    expect(counts).toEqual({ processed: 0, skipped: 1 });
    expect(contactRows[0]!.name).toBe("Contacto de WhatsApp"); // sin tocar
  });

  it("respeta un nombre que el operador ya editó (no lo pisa)", async () => {
    contactRows = [{ id: "contact_1", archivedAt: null, name: "Doña Carmen", phone: "5215512345678" }];
    isFallbackName.mockReturnValue(false);
    const { processSmbAppStateSyncValue } = await import("@/server/agencia/whatsapp-signup/history-sync");
    const counts = await processSmbAppStateSyncValue({
      metadata: { phone_number_id: "phone_1" },
      state_sync: [{ contact: { phone_number: "5215512345678", full_name: "Cliente Real" } }],
    });
    expect(counts).toEqual({ processed: 0, skipped: 1 });
    expect(contactRows[0]!.name).toBe("Doña Carmen");
  });

  it("una entrada con action:'remove' se descarta siempre, sin tocar nada", async () => {
    contactRows = [{ id: "contact_1", archivedAt: null, name: "Contacto de WhatsApp", phone: "5215512345678" }];
    const { processSmbAppStateSyncValue } = await import("@/server/agencia/whatsapp-signup/history-sync");
    const counts = await processSmbAppStateSyncValue({
      metadata: { phone_number_id: "phone_1" },
      state_sync: [{ action: "remove", contact: { phone_number: "5215512345678", full_name: "Cliente Real" } }],
    });
    expect(counts).toEqual({ processed: 0, skipped: 1 });
    expect(contactRows[0]!.name).toBe("Contacto de WhatsApp");
  });

  it("entradas sin teléfono o sin nombre se descartan", async () => {
    const { processSmbAppStateSyncValue } = await import("@/server/agencia/whatsapp-signup/history-sync");
    const counts = await processSmbAppStateSyncValue({
      metadata: { phone_number_id: "phone_1" },
      state_sync: [{ contact: { phone_number: "5215512345678" } }, { contact: { full_name: "Sin teléfono" } }],
    });
    expect(counts).toEqual({ processed: 0, skipped: 2 });
  });
});

import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { normalizeMx } from "@/lib/meta/client";
import { getCredentialsByPhoneNumberId } from "@/server/whatsapp/credentials";
import { getOrCreateContactByIdentity } from "@/server/inbox/identity";
import { getOrCreateConversation } from "@/server/inbox/ingest";

/**
 * `history` y `smb_app_state_sync` (fork): siguen al override de webhook que
 * pide `complete.ts`, así que llegan a ESTA app aunque el resto del webhook
 * nunca los haya visto. Ninguno de los dos puede parecerse a un mensaje
 * nuevo: nunca publican en el bus de eventos (`server/events/bus`) ni pasan
 * por `maybeRunAgentTurn` — literal, no se importan esas funciones aquí.
 *
 * OJO de honestidad: la forma exacta de estos dos payloads sale de la
 * documentación de Meta (Coexistence — "Sync your app state" / history),
 * no de un payload real verificado en esta sesión (sin acceso a Meta en
 * vivo). El parseo es defensivo a propósito: una forma inesperada nunca
 * lanza hacia el webhook, solo cuenta como `skipped` — ver el reporte de la
 * tarea para el detalle.
 */

type StateSyncContact = {
  phone_number?: string;
  full_name?: string;
  first_name?: string;
};

export type SmbAppStateSyncValue = {
  metadata?: { phone_number_id?: string };
  state_sync?: { type?: string; contact?: StateSyncContact }[];
};

type HistoryMessage = {
  id?: string;
  from?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
};

type HistoryThread = { id?: string; messages?: HistoryMessage[] };

export type HistoryFieldValue = {
  metadata?: { phone_number_id?: string };
  history?: { threads?: HistoryThread[] }[];
};

export type SyncCounts = { processed: number; skipped: number };

function digitsOnly(value: string): string {
  return value.replace(/[^\d]/g, "");
}

function toDate(timestamp: string | undefined): Date {
  const n = Number(timestamp);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000) : new Date();
}

/**
 * `smb_app_state_sync` → nombres de contacto (upsert; NUNCA crea conversación
 * ni mensaje). Reusa `getOrCreateContactByIdentity`, que ya sabe no pisar un
 * nombre que el operador editó a mano (`isFallbackName`).
 */
export async function processSmbAppStateSyncValue(value: SmbAppStateSyncValue): Promise<SyncCounts> {
  const phoneNumberId = value.metadata?.phone_number_id;
  if (!phoneNumberId) return { processed: 0, skipped: 0 };
  const credentials = await getCredentialsByPhoneNumberId(phoneNumberId);
  if (!credentials) return { processed: 0, skipped: 0 };

  let processed = 0;
  let skipped = 0;
  for (const entry of value.state_sync ?? []) {
    try {
      const rawPhone = entry.contact?.phone_number;
      const name = entry.contact?.full_name?.trim() || entry.contact?.first_name?.trim();
      if (!rawPhone || !name) {
        skipped++;
        continue;
      }
      const phone = normalizeMx(digitsOnly(rawPhone));
      if (!phone) {
        skipped++;
        continue;
      }
      await getOrCreateContactByIdentity(credentials.organizationId, {
        identity: phone,
        phone,
        waUserId: null,
        profileName: name,
      });
      processed++;
    } catch (err) {
      skipped++;
      console.warn(
        "[whatsapp-signup] smb_app_state_sync: entrada descartada:",
        err instanceof Error ? err.message : err
      );
    }
  }
  return { processed, skipped };
}

/**
 * `history` → mensajes pasados, idempotentes por `wa_message_id`. Deliberado:
 * NO toca `conversation.lastMessageAt`/`unreadCount` (mensajes viejos no
 * deben desplazar ni marcar como no leída una conversación de hoy), no baja
 * adjuntos (solo texto; otros tipos quedan con `text: null`), y nunca llama
 * `publish()` ni `maybeRunAgentTurn`.
 */
export async function processHistoryValue(value: HistoryFieldValue): Promise<SyncCounts> {
  const phoneNumberId = value.metadata?.phone_number_id;
  if (!phoneNumberId) return { processed: 0, skipped: 0 };
  const credentials = await getCredentialsByPhoneNumberId(phoneNumberId);
  if (!credentials) return { processed: 0, skipped: 0 };
  const organizationId = credentials.organizationId;
  const db = getDb();

  let processed = 0;
  let skipped = 0;
  for (const entry of value.history ?? []) {
    for (const thread of entry.threads ?? []) {
      const counterpart = thread.id ? normalizeMx(digitsOnly(String(thread.id))) : null;
      if (!counterpart) {
        skipped += thread.messages?.length ?? 0;
        continue;
      }
      for (const msg of thread.messages ?? []) {
        try {
          if (!msg.id) {
            skipped++;
            continue;
          }
          const { contact } = await getOrCreateContactByIdentity(organizationId, {
            identity: counterpart,
            phone: counterpart,
            waUserId: null,
            profileName: null,
          });
          const conversation = await getOrCreateConversation(organizationId, contact.id);
          const fromDigits = msg.from ? normalizeMx(digitsOnly(msg.from)) : "";
          const direction = fromDigits === counterpart ? "in" : "out";

          const inserted = await db
            .insert(schema.message)
            .values({
              id: newId("message"),
              organizationId,
              conversationId: conversation.id,
              waMessageId: msg.id,
              direction,
              type: msg.type ?? "text",
              text: msg.text?.body ?? null,
              status: direction === "in" ? "delivered" : "sent",
              ...(direction === "out" ? { origin: "manual" as const } : {}),
              waTimestamp: toDate(msg.timestamp),
            })
            .onConflictDoNothing({ target: [schema.message.waMessageId] })
            .returning({ id: schema.message.id });
          if (inserted[0]) processed++;
          else skipped++; // ya existía (idempotencia, no un error)
        } catch (err) {
          skipped++;
          console.warn(
            "[whatsapp-signup] history: mensaje descartado:",
            err instanceof Error ? err.message : err
          );
        }
      }
    }
  }
  return { processed, skipped };
}

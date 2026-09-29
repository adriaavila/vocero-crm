import { eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { normalizeMx } from "@/lib/meta/client";
import { getCredentialsByPhoneNumberId } from "@/server/whatsapp/credentials";
import { getOrCreateContactByIdentity, isFallbackName } from "@/server/inbox/identity";
import { getOrCreateConversation } from "@/server/inbox/ingest";

/**
 * `history` y `smb_app_state_sync` (fork): siguen al override de webhook que
 * pide `complete.ts`, así que llegan a ESTA app aunque el resto del webhook
 * nunca los haya visto. Ninguno de los dos puede parecerse a un mensaje
 * nuevo: nunca publican en el bus de eventos (`server/events/bus`) ni pasan
 * por `maybeRunAgentTurn` — literal, no se importan esas funciones aquí — y
 * `history` marca sus filas `origin: "history"` para que
 * `server/ai/worker.ts` las excluya del chequeo de "hay algo nuevo, reprograma
 * el turno" aunque su `createdAt` cayera dentro de la ventana del turno.
 *
 * Solo se descarta (cuenta como `skipped`) lo que es un problema de FORMA
 * (falta un id, un timestamp inválido, sin thread). Un error de base de datos
 * NO se atrapa aquí: se deja subir para que el webhook responda 503 y Meta
 * reintente — los inserts son idempotentes por `wa_message_id`, así que un
 * reintento completo es seguro.
 *
 * OJO de honestidad: la forma exacta de estos dos payloads sale de la
 * documentación de Meta (Coexistence — "Sync your app state" / history), no
 * de un payload real verificado en esta sesión (sin acceso a Meta en vivo).
 */

type StateSyncContact = {
  phone_number?: string;
  full_name?: string;
  first_name?: string;
};

export type SmbAppStateSyncValue = {
  metadata?: { phone_number_id?: string };
  state_sync?: { type?: string; action?: string; contact?: StateSyncContact }[];
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

/** `null` si el timestamp falta o no es un número positivo válido — se descarta, nunca se inventa "ahora". */
function validWaTimestamp(timestamp: string | undefined): Date | null {
  if (!timestamp) return null;
  const n = Number(timestamp);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000) : null;
}

/**
 * `smb_app_state_sync` → SOLO actualiza el nombre de un contacto que YA
 * existe: nunca crea uno nuevo, nunca reactiva uno archivado, y nunca toca
 * una entrada con `action: "remove"`. El upsert real (crear/reconciliar) es
 * `getOrCreateContactByIdentity`, pero ESE camino es el de un mensaje real —
 * un evento de sincronización de agenda no es evidencia de que alguien le
 * escribió a este negocio.
 */
export async function processSmbAppStateSyncValue(value: SmbAppStateSyncValue): Promise<SyncCounts> {
  const phoneNumberId = value.metadata?.phone_number_id;
  if (!phoneNumberId) return { processed: 0, skipped: 0 };
  const credentials = await getCredentialsByPhoneNumberId(phoneNumberId);
  if (!credentials) return { processed: 0, skipped: 0 };

  const db = getDb();
  let processed = 0;
  let skipped = 0;
  for (const entry of value.state_sync ?? []) {
    if (entry.action === "remove") {
      skipped++;
      continue;
    }
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

    const rows = await db
      .select()
      .from(schema.contact)
      .where(
        sql`${schema.contact.organizationId} = ${credentials.organizationId} and ${schema.contact.channel} = 'whatsapp' and ${schema.contact.waIdentity} = ${phone}`
      )
      .limit(1);
    const existing = rows[0];
    if (!existing || existing.archivedAt) {
      // No existe, o está archivado: un sync de agenda no es motivo para
      // crearlo ni para reactivarlo — eso solo lo hace un mensaje real.
      skipped++;
      continue;
    }
    if (!isFallbackName(existing)) {
      // El operador ya le puso un nombre real: el sync nunca lo pisa.
      skipped++;
      continue;
    }
    await db
      .update(schema.contact)
      .set({ name, updatedAt: new Date() })
      .where(eq(schema.contact.id, existing.id));
    processed++;
  }
  return { processed, skipped };
}

/**
 * `history` → mensajes pasados, idempotentes por `wa_message_id`. Resuelve
 * contacto y conversación UNA vez por thread (no por mensaje). `createdAt`
 * es el timestamp real de WhatsApp, nunca "ahora": si no, un historial
 * importado hoy se vería más reciente que mensajes de verdad de hace
 * semanas. `conversation.lastMessageAt` solo puede AVANZAR
 * (`GREATEST(actual, nuevo)`), nunca retroceder si ya había algo más nuevo.
 * No baja adjuntos (solo texto; otros tipos quedan con `text: null`), y
 * nunca llama `publish()` ni `maybeRunAgentTurn`.
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

      // Lookups UNA vez por thread, no por mensaje.
      const { contact } = await getOrCreateContactByIdentity(organizationId, {
        identity: counterpart,
        phone: counterpart,
        waUserId: null,
        profileName: null,
      });
      const conversation = await getOrCreateConversation(organizationId, contact.id);

      let maxTimestamp: Date | null = null;
      for (const msg of thread.messages ?? []) {
        const waTimestamp = validWaTimestamp(msg.timestamp);
        if (!msg.id || !waTimestamp) {
          skipped++;
          continue;
        }
        const fromDigits = msg.from ? normalizeMx(digitsOnly(msg.from)) : "";
        const direction = fromDigits === counterpart ? "in" : "out";

        // Errores de BD de aquí en adelante NO se atrapan: deben subir para
        // que el webhook responda 503 y Meta reintente (insert idempotente).
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
            origin: "history",
            waTimestamp,
            createdAt: waTimestamp,
          })
          .onConflictDoNothing({ target: [schema.message.waMessageId] })
          .returning({ id: schema.message.id });
        if (inserted[0]) {
          processed++;
          if (!maxTimestamp || waTimestamp > maxTimestamp) maxTimestamp = waTimestamp;
        } else {
          skipped++; // ya existía (idempotencia, no un error)
        }
      }

      if (maxTimestamp) {
        await db
          .update(schema.conversation)
          .set({
            lastMessageAt: sql`GREATEST(coalesce(${schema.conversation.lastMessageAt}, to_timestamp(0)), ${maxTimestamp})`,
          })
          .where(eq(schema.conversation.id, conversation.id));
      }
    }
  }
  return { processed, skipped };
}

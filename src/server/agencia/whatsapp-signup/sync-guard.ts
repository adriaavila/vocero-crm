import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import type { EmbeddedSignupMode } from "./state";

/**
 * Guardia de "una vez por tipo" de la importación de coexistencia
 * (`organization.metadata.allok.whatsappSignup`, no-secreto). Meta solo deja
 * pedir `history`/`smb_app_state_sync` UNA vez por número — sin este guard, un
 * segundo intento de conexión (retry del dueño, doble click) volvería a
 * pedirlo y Meta lo rechazaría en silencio o lo ignoraría.
 *
 * Reutiliza el patrón de `server/saas/billing.ts` (JSON en `organization.
 * metadata`, namespace `allok`): sin tabla nueva.
 */

export type WhatsappSignupSyncMetadata = {
  phoneNumberId: string;
  mode: EmbeddedSignupMode;
  syncRequestedAt: string;
  requestIds: { history?: string | null; smb_app_state_sync?: string | null };
};

type Metadata = Record<string, unknown>;

function parseMetadata(raw: string | null | undefined): Metadata {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Metadata)
      : {};
  } catch {
    return {};
  }
}

function allokMetadata(metadata: Metadata): Metadata {
  const allok = metadata.allok;
  return allok && typeof allok === "object" && !Array.isArray(allok) ? (allok as Metadata) : {};
}

export function whatsappSignupSyncFromMetadata(
  raw: string | null | undefined
): WhatsappSignupSyncMetadata | null {
  const value = allokMetadata(parseMetadata(raw)).whatsappSignup;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.phoneNumberId !== "string" || !record.phoneNumberId) return null;
  const requestIds =
    record.requestIds && typeof record.requestIds === "object" && !Array.isArray(record.requestIds)
      ? (record.requestIds as WhatsappSignupSyncMetadata["requestIds"])
      : {};
  return {
    phoneNumberId: record.phoneNumberId,
    mode: record.mode === "cloud_api" ? "cloud_api" : "coexistence",
    syncRequestedAt:
      typeof record.syncRequestedAt === "string" ? record.syncRequestedAt : new Date(0).toISOString(),
    requestIds,
  };
}

export async function getWhatsappSignupSync(
  organizationId: string
): Promise<WhatsappSignupSyncMetadata | null> {
  const rows = await getDb()
    .select({ metadata: schema.organization.metadata })
    .from(schema.organization)
    .where(eq(schema.organization.id, organizationId))
    .limit(1);
  return whatsappSignupSyncFromMetadata(rows[0]?.metadata);
}

/** true si YA se pidió el sync de coexistencia para ESE número exacto. */
export function alreadySyncedForPhone(
  sync: WhatsappSignupSyncMetadata | null,
  phoneNumberId: string
): boolean {
  return sync?.phoneNumberId === phoneNumberId;
}

export async function recordWhatsappSignupSync(
  organizationId: string,
  value: WhatsappSignupSyncMetadata
): Promise<void> {
  const rows = await getDb()
    .select({ metadata: schema.organization.metadata })
    .from(schema.organization)
    .where(eq(schema.organization.id, organizationId))
    .limit(1);
  const metadata = parseMetadata(rows[0]?.metadata);
  metadata.allok = { ...allokMetadata(metadata), whatsappSignup: value };
  await getDb()
    .update(schema.organization)
    .set({ metadata: JSON.stringify(metadata) })
    .where(eq(schema.organization.id, organizationId));
}

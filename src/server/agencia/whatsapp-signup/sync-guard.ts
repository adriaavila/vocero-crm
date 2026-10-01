import { eq } from "drizzle-orm";
import { getDb, getSql, schema } from "@/lib/db";
import type { EmbeddedSignupMode } from "./state";

/**
 * Guardia de "una vez por tipo" de la importación de coexistencia, y último
 * error del alta — los dos en `organization.metadata` (JSON en `text`, sin
 * tabla nueva), namespace `allok` (mismo patrón que `server/saas/billing.ts`).
 *
 * Las escrituras son UPDATE atómicos con `jsonb_set`/`#-` apuntados a UNA
 * clave (`allok.whatsappSignup` o `allok.whatsappSignupError`): nunca leen y
 * reescriben el blob completo, así que una escritura concurrente de
 * `saveOrganizationBilling` (`allok.billing`) no se pisa. El "claim" del sync
 * además es condicional en la MISMA sentencia (`WHERE ... <> phoneNumberId`):
 * dos completions concurrentes para el mismo número no pueden las dos ganar
 * el "aún no se pidió" y pedirle a Meta dos veces el mismo sync de un solo uso.
 */

export type WhatsappSignupSyncMetadata = {
  phoneNumberId: string;
  mode: EmbeddedSignupMode;
  syncRequestedAt: string;
  requestIds: { history?: string | null; smb_app_state_sync?: string | null };
};

export type WhatsappSignupErrorMetadata = {
  phoneNumberId: string;
  step: string;
  at: string;
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

export function whatsappSignupErrorFromMetadata(
  raw: string | null | undefined
): WhatsappSignupErrorMetadata | null {
  const value = allokMetadata(parseMetadata(raw)).whatsappSignupError;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.phoneNumberId !== "string" || typeof record.step !== "string") return null;
  return {
    phoneNumberId: record.phoneNumberId,
    step: record.step,
    at: typeof record.at === "string" ? record.at : new Date(0).toISOString(),
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

export async function getWhatsappSignupError(
  organizationId: string
): Promise<WhatsappSignupErrorMetadata | null> {
  const rows = await getDb()
    .select({ metadata: schema.organization.metadata })
    .from(schema.organization)
    .where(eq(schema.organization.id, organizationId))
    .limit(1);
  return whatsappSignupErrorFromMetadata(rows[0]?.metadata);
}

/** true si YA se pidió el sync de coexistencia para ESE número exacto. */
export function alreadySyncedForPhone(
  sync: WhatsappSignupSyncMetadata | null,
  phoneNumberId: string
): boolean {
  return sync?.phoneNumberId === phoneNumberId;
}

/**
 * Reserva atómica del sync para `phoneNumberId` ANTES de llamar a Meta.
 * `true` = ganó la reserva (nadie la tenía para ESTE número); `false` = ya
 * estaba reservada (otro completion, o un intento previo) — no llamar a Meta.
 */
export async function claimWhatsappSignupSync(
  organizationId: string,
  phoneNumberId: string,
  mode: EmbeddedSignupMode
): Promise<boolean> {
  const sql = getSql();
  const claim: WhatsappSignupSyncMetadata = {
    phoneNumberId,
    mode,
    syncRequestedAt: new Date().toISOString(),
    requestIds: {},
  };
  const rows = await sql<{ id: string }[]>`
    UPDATE organization
    SET metadata = jsonb_set(
      jsonb_set(
        coalesce(metadata::jsonb, '{}'::jsonb),
        '{allok}',
        coalesce(metadata::jsonb->'allok', '{}'::jsonb),
        true
      ),
      '{allok,whatsappSignup}',
      ${JSON.stringify(claim)}::jsonb,
      true
    )::text
    WHERE id = ${organizationId}
      AND coalesce(metadata::jsonb #>> '{allok,whatsappSignup,phoneNumberId}', '') <> ${phoneNumberId}
    RETURNING id
  `;
  return rows.length > 0;
}

/** Anota los request_id tras pedirle el sync a Meta — solo si la reserva sigue siendo la nuestra. */
export async function finalizeWhatsappSignupSync(
  organizationId: string,
  phoneNumberId: string,
  requestIds: WhatsappSignupSyncMetadata["requestIds"]
): Promise<void> {
  const sql = getSql();
  await sql`
    UPDATE organization
    SET metadata = jsonb_set(metadata::jsonb, '{allok,whatsappSignup,requestIds}', ${JSON.stringify(requestIds)}::jsonb, true)::text
    WHERE id = ${organizationId}
      AND metadata::jsonb #>> '{allok,whatsappSignup,phoneNumberId}' = ${phoneNumberId}
  `;
}

/**
 * Libera la reserva si AMBOS envíos a Meta fallaron (ninguno llegó a
 * consumir la oportunidad de un solo uso): sin esto, un tropiezo de red
 * dejaría el número marcado "ya sincronizado" para siempre sin haberlo
 * pedido nunca. Solo libera si la reserva sigue siendo la nuestra.
 */
export async function releaseWhatsappSignupSync(
  organizationId: string,
  phoneNumberId: string
): Promise<void> {
  const sql = getSql();
  await sql`
    UPDATE organization
    SET metadata = (metadata::jsonb #- '{allok,whatsappSignup}')::text
    WHERE id = ${organizationId}
      AND metadata::jsonb #>> '{allok,whatsappSignup,phoneNumberId}' = ${phoneNumberId}
  `;
}

/** Último paso que falló para este número (diagnóstico — no bloquea nada por sí solo). */
export async function recordWhatsappSignupError(
  organizationId: string,
  phoneNumberId: string,
  step: string
): Promise<void> {
  const sql = getSql();
  const value: WhatsappSignupErrorMetadata = { phoneNumberId, step, at: new Date().toISOString() };
  await sql`
    UPDATE organization
    SET metadata = jsonb_set(
      jsonb_set(
        coalesce(metadata::jsonb, '{}'::jsonb),
        '{allok}',
        coalesce(metadata::jsonb->'allok', '{}'::jsonb),
        true
      ),
      '{allok,whatsappSignupError}',
      ${JSON.stringify(value)}::jsonb,
      true
    )::text
    WHERE id = ${organizationId}
  `;
}

/** Se llama al completar TODO el alta sin errores: el aviso de "falta activar" ya no aplica. */
export async function clearWhatsappSignupError(organizationId: string): Promise<void> {
  const sql = getSql();
  await sql`
    UPDATE organization
    SET metadata = (metadata::jsonb #- '{allok,whatsappSignupError}')::text
    WHERE id = ${organizationId} AND metadata IS NOT NULL
  `;
}

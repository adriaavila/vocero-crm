import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";

/**
 * Vertical de negocio por organización (fork de agencia).
 *
 * Vocero es "un CRM de conversaciones y leads de WhatsApp" (Constitución
 * VIII) — el vertical inmobiliario agrega un catálogo de propiedades y su
 * matching como MÓDULO opcional, nunca cambia el núcleo. Sigue el mismo
 * patrón que los canales opcionales (ADR-001): las tablas existen siempre,
 * apagadas por defecto, y lo que decide si el módulo EXISTE es una bandera —
 * aquí por ORGANIZACIÓN (`organization.metadata.vertical`), no de instancia
 * completa, porque un mismo despliegue de Rei CRM sirve a varias agencias y
 * cada una es dueña de su propio vertical.
 *
 * Ver la enmienda de `.specify/memory/constitution.md` (Principio VIII).
 */

export type Vertical = "inmobiliario";

const VERTICALS: readonly Vertical[] = ["inmobiliario"];

function isVertical(value: unknown): value is Vertical {
  return typeof value === "string" && (VERTICALS as readonly string[]).includes(value);
}

type OrgMetadata = Record<string, unknown>;

function parseMetadata(raw: string | null | undefined): OrgMetadata {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as OrgMetadata)
      : {};
  } catch {
    return {};
  }
}

/**
 * El vertical por defecto de las organizaciones NUEVAS de esta instancia,
 * leído directo de `process.env` (igual que `agendaEnabled()`): preguntar si
 * un vertical existe no puede depender de que TODO el entorno valide.
 * `DEFAULT_VERTICAL` sí está declarada en el esquema de `lib/env.ts`, donde
 * vive su documentación y su tipo.
 *
 * Sin ella (el caso de allok), `undefined`: las organizaciones nuevas nacen
 * sin vertical y el CRM se comporta exactamente como antes de este cambio.
 */
export function defaultVerticalFromEnv(): Vertical | undefined {
  const raw = process.env.DEFAULT_VERTICAL?.trim();
  return isVertical(raw) ? raw : undefined;
}

/** El vertical guardado en `organization.metadata`, o `null` si no tiene. */
export function verticalFromMetadata(
  raw: string | null | undefined
): Vertical | null {
  const meta = parseMetadata(raw);
  return isVertical(meta.vertical) ? meta.vertical : null;
}

/** El vertical de una organización. `null` = ninguno (comportamiento de allok). */
export async function getOrgVertical(
  organizationId: string
): Promise<Vertical | null> {
  const rows = await getDb()
    .select({ metadata: schema.organization.metadata })
    .from(schema.organization)
    .where(eq(schema.organization.id, organizationId))
    .limit(1);
  return verticalFromMetadata(rows[0]?.metadata);
}

/** true si esta organización tiene el vertical inmobiliario activo. */
export async function isRealtyOrg(organizationId: string): Promise<boolean> {
  return (await getOrgVertical(organizationId)) === "inmobiliario";
}

/**
 * Fija el vertical de una organización, sin pisar el resto de su metadata
 * (marca, facturación…) — mismo merge campo-a-campo que `saveBranding`.
 * Idempotente: se puede llamar tantas veces como haga falta (Constitución IV).
 *
 * Se usa al crear el negocio (`server/auth/on-signup.ts`, admin
 * `POST /api/saas/businesses` — comparten el mismo hook de better-auth) y,
 * como red de seguridad, al cargar el seed demo del vertical: una
 * organización sembrada con propiedades pero sin la bandera dejaría el
 * catálogo recién creado detrás de un 404.
 */
export async function setOrgVertical(
  organizationId: string,
  vertical: Vertical
): Promise<void> {
  const db = getDb();
  const rows = await db
    .select({ metadata: schema.organization.metadata })
    .from(schema.organization)
    .where(eq(schema.organization.id, organizationId))
    .limit(1);
  const meta = parseMetadata(rows[0]?.metadata);
  if (meta.vertical === vertical) return;
  meta.vertical = vertical;
  await db
    .update(schema.organization)
    .set({ metadata: JSON.stringify(meta) })
    .where(eq(schema.organization.id, organizationId));
}

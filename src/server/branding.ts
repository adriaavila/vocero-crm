import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import {
  DEFAULT_BRANDING,
  normalizeBranding,
  type Branding,
} from "@/lib/branding";
import { brand } from "@/lib/brand";
import { isAllokBrand } from "@/lib/tenant-host";

/**
 * El respaldo de una instancia branded (allok o Rei) sin organización
 * resuelta todavía: nombre y acento de la MARCA DEL DESPLIEGUE, no de
 * `SAAS_BRANDING` a secas — ese const es literalmente el de allok (lo sigue
 * siendo, y `tests/unit/branding.test.ts` lo fija así) y no sirve para Rei.
 */
function deploymentBrandedFallback(): Branding {
  return { ...DEFAULT_BRANDING, name: brand().name, accent: brand().defaultAccent };
}

/** Marca guardada en organization.metadata (JSON de Better Auth). */

function parseMetadata(metadata: string | null): Record<string, unknown> {
  if (!metadata) return {};
  try {
    const parsed = JSON.parse(metadata) as unknown;
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/**
 * Marca + a qué organización pertenece.
 *
 * El icono se guarda como archivo en `MEDIA_DIR/{organizationId}/favicon`, así
 * que servirlo necesita el id — y la ruta que lo sirve es pública (el login
 * también tiene pestaña), donde no hay sesión de la que sacarlo.
 */
export async function getBrandingContext(
  organizationId?: string | null
): Promise<{ organizationId: string | null; branding: Branding }> {
  const db = getDb();
  const rows = organizationId
    ? await db
        .select({ id: schema.organization.id, name: schema.organization.name, metadata: schema.organization.metadata })
        .from(schema.organization)
        .where(eq(schema.organization.id, organizationId))
        .limit(1)
    : organizationId === null
      ? []
      : // Sin sesión (login legacy, layout raíz): la única organización de la instancia.
      await db
        .select({ id: schema.organization.id, name: schema.organization.name, metadata: schema.organization.metadata })
        .from(schema.organization)
        .limit(1);
  if (!rows[0]) {
    return { organizationId: null, branding: isAllokBrand() ? deploymentBrandedFallback() : DEFAULT_BRANDING };
  }
  const meta = parseMetadata(rows[0].metadata);
  const customBranding = meta.branding as Partial<Branding> | undefined;
  const branding = normalizeBranding(customBranding ?? null);
  return {
    organizationId: rows[0].id,
    // Un negocio que no tocó su marca lleva su nombre y el acento de la marca
    // del despliegue (en el SaaS y en una dedicada); con `ALLOK_BRAND=off`,
    // la de Vocero.
    branding: customBranding || !isAllokBrand()
      ? branding
      : { ...branding, name: rows[0].name, accent: brand().defaultAccent },
  };
}

export async function getBranding(
  organizationId?: string | null
): Promise<Branding> {
  return (await getBrandingContext(organizationId)).branding;
}

export async function saveBranding(
  organizationId: string,
  branding: Branding
): Promise<void> {
  const db = getDb();
  const rows = await db
    .select({ metadata: schema.organization.metadata })
    .from(schema.organization)
    .where(eq(schema.organization.id, organizationId))
    .limit(1);
  const meta = parseMetadata(rows[0]?.metadata ?? null);
  meta.branding = normalizeBranding(branding);
  await db
    .update(schema.organization)
    .set({ metadata: JSON.stringify(meta) })
    .where(eq(schema.organization.id, organizationId));
}

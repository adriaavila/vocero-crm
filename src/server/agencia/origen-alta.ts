import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { parseOrigen, type OrigenAlta, type OrigenGuardado } from "@/lib/origen-alta";
import { getOrganizationForBillingLocked } from "@/server/saas/billing";

/**
 * Capa de agencia — de dónde llegó cada alta del SaaS, guardado en la propia
 * organización (`metadata.allok.origen`, texto JSON: sin migración). Las
 * reglas de limpieza y de lectura son puras y viven en `lib/origen-alta`; acá
 * solo se escribe.
 */
export { fuenteDeOrigen, origenFromMetadata, parseOrigen } from "@/lib/origen-alta";
export type { OrigenAlta, OrigenGuardado } from "@/lib/origen-alta";

export type GuardarOrigenResultado = "guardado" | "ya_existia" | "no_encontrado" | "vacio";

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/**
 * Anota el origen del alta UNA vez: el primer toque gana. Lee la fila con
 * `FOR UPDATE` dentro de una transacción (la misma que usa facturación), así
 * que dos envíos a la vez no se pisan ni pisan un cambio de plan en vuelo.
 * Solo toca `metadata.allok.origen`: `allok.billing` y todo lo demás quedan
 * como estaban.
 */
export async function guardarOrigen(
  organizationId: string,
  origen: OrigenAlta,
): Promise<GuardarOrigenResultado> {
  const limpio = parseOrigen(origen);
  if (!limpio) return "vacio";
  return getDb().transaction(async (tx) => {
    const organization = await getOrganizationForBillingLocked(organizationId, tx);
    if (!organization) return "no_encontrado" as const;
    let metadata: Record<string, unknown> = {};
    if (organization.metadata) {
      try {
        metadata = asObject(JSON.parse(organization.metadata)) ?? {};
      } catch {
        // Metadata ilegible: no se reescribe a ciegas (perdería lo que hubiera).
        return "no_encontrado" as const;
      }
    }
    const allok = asObject(metadata.allok) ?? {};
    if (asObject(allok.origen)) return "ya_existia" as const;
    const guardado: OrigenGuardado = { ...limpio, at: new Date().toISOString() };
    metadata.allok = { ...allok, origen: guardado };
    await tx
      .update(schema.organization)
      .set({ metadata: JSON.stringify(metadata) })
      .where(eq(schema.organization.id, organizationId));
    return "guardado" as const;
  });
}

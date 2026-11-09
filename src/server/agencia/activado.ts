import { and, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { activatedAtFromMetadata, everActivatedFrom } from "@/lib/activado";
import { getOrganizationForBillingLocked } from "@/server/saas/billing";

/** ¿El negocio ya encendió alguna vez a su agente? Ver `lib/activado`. */
export async function hasEverActivated(organizationId: string, enabled: boolean): Promise<boolean> {
  if (enabled) return true;
  const db = getDb();
  const [org] = await db
    .select({ metadata: schema.organization.metadata })
    .from(schema.organization)
    .where(eq(schema.organization.id, organizationId))
    .limit(1);
  if (activatedAtFromMetadata(org?.metadata)) return true;
  const real = await db.execute(sql`
    select 1 from message m
    join conversation c on c.id = m.conversation_id
    where m.organization_id = ${organizationId}
      and m.direction = 'out' and m.ai_generated = true and c.is_test = false
    limit 1`);
  return everActivatedFrom({ enabled, metadata: org?.metadata, hasRealAiOutbound: real.length > 0 });
}

/**
 * Anota la primera activación en `metadata.allok.activatedAt` (texto JSON, junto
 * a `billing` y `origen`; solo esa llave se toca). Una vez: no se pisa.
 */
export async function markActivated(organizationId: string, now = new Date()): Promise<void> {
  await getDb().transaction(async (tx) => {
    const organization = await getOrganizationForBillingLocked(organizationId, tx);
    if (!organization) return;
    let metadata: Record<string, unknown> = {};
    if (organization.metadata) {
      try {
        const parsed = JSON.parse(organization.metadata);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) metadata = parsed as Record<string, unknown>;
      } catch {
        // Ilegible: no se reescribe a ciegas (perdería lo que hubiera).
        return;
      }
    }
    const allok = metadata.allok && typeof metadata.allok === "object" && !Array.isArray(metadata.allok)
      ? (metadata.allok as Record<string, unknown>)
      : {};
    if (typeof allok.activatedAt === "string") return;
    metadata.allok = { ...allok, activatedAt: now.toISOString() };
    await tx
      .update(schema.organization)
      .set({ metadata: JSON.stringify(metadata) })
      .where(and(eq(schema.organization.id, organizationId)));
  });
}

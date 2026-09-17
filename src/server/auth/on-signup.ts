import { and, count, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { isAllokSaaSMode, isLegacyAppHost, isSaaSAppHost, slugifyTenantName, tenantSlugFromHost } from "@/lib/tenant-host";
import { defaultAgentProfile } from "@/server/agent/default-profile";

/** Etapas sembradas del pipeline (US2). */
const SEED_STAGES: { name: string; kind: "open" | "won" | "lost" }[] = [
  { name: "Nuevo", kind: "open" },
  { name: "En conversación", kind: "open" },
  { name: "Interesado", kind: "open" },
  { name: "Cliente", kind: "won" },
  { name: "Perdido", kind: "lost" },
];

/**
 * Alta de usuario: en modo legacy crea la organización única; en modo Allok
 * crea una organización por cuenta y deja al usuario como propietario.
 *
 * Solo actúa si NO existe ninguna organización (las cuentas de equipo las crea
 * el propietario y reciben su membresía explícita). Un advisory lock evita que
 * dos registros simultáneos en instancia vacía creen dos organizaciones.
 */
export async function onUserCreated(
  userId: string,
  userName: string,
  options?: { skipOrganization?: boolean },
) {
  if (options?.skipOrganization) return;
  const db = getDb();
  await db.transaction(async (tx) => {
    // Legacy necesita un lock global para el primer arranque. SaaS solo debe
    // serializar organizaciones con el mismo slug; clientes distintos pueden
    // registrarse en paralelo.
    const baseSlug = isAllokSaaSMode() ? slugifyTenantName(userName) : "principal";
    if (isAllokSaaSMode()) {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${baseSlug}))`);
    } else {
      await tx.execute(sql`select pg_advisory_xact_lock(874201)`);
    }
    if (isAllokSaaSMode()) {
      const existingMembership = await tx
        .select({ id: schema.member.id })
        .from(schema.member)
        .where(eq(schema.member.userId, userId))
        .limit(1);
      if (existingMembership[0]) return;
    } else {
      const [orgs] = await tx
        .select({ n: count() })
        .from(schema.organization);
      if ((orgs?.n ?? 0) > 0) return;
    }

    const orgId = newId("organization");
    const matchingSlug = await tx
      .select({ id: schema.organization.id })
      .from(schema.organization)
      .where(eq(schema.organization.slug, baseSlug))
      .limit(1);
    const collisionSuffix = "-" + userId.slice(-6).toLowerCase();
    const slug = matchingSlug[0]
      ? baseSlug.slice(0, 50 - collisionSuffix.length).replace(/-+$/, "") + collisionSuffix
      : baseSlug;
    await tx.insert(schema.organization).values({
      id: orgId,
      name: userName || "Mi negocio",
      slug,
    });
    await tx.insert(schema.member).values({
      id: newId("member"),
      organizationId: orgId,
      userId,
      role: "owner",
    });
    await tx.insert(schema.pipelineStage).values(
      SEED_STAGES.map((s, i) => ({
        id: newId("stage"),
        organizationId: orgId,
        name: s.name,
        position: i,
        kind: s.kind,
      }))
    );
    await tx.insert(schema.agentProfile).values({
      id: newId("agentProfile"),
      organizationId: orgId,
      ...defaultAgentProfile(),
    });
  });
}

/** Organización activa de un usuario (su primera membresía). */
export async function resolveActiveOrganizationId(
  userId: string
): Promise<string | null> {
  return (await resolveMembership(userId))?.organizationId ?? null;
}

export async function resolveMembership(
  userId: string
): Promise<{ organizationId: string; role: string } | null> {
  const db = getDb();
  const rows = await db
    .select({
      organizationId: schema.member.organizationId,
      role: schema.member.role,
    })
    .from(schema.member)
    .where(eq(schema.member.userId, userId))
    .limit(1);
  return rows[0] ?? null;
}

export async function resolveMembershipForHost(
  userId: string,
  host: string | null | undefined,
): Promise<{ organizationId: string; role: string } | null> {
  const slug = tenantSlugFromHost(host);
  if (!slug) {
    if (isLegacyAppHost(host)) {
      const legacyOrganizationId = await resolveLegacyOrganizationId();
      if (legacyOrganizationId) {
        const rows = await getDb()
          .select({ organizationId: schema.member.organizationId, role: schema.member.role })
          .from(schema.member)
          .where(and(
            eq(schema.member.userId, userId),
            eq(schema.member.organizationId, legacyOrganizationId),
          ))
          .limit(1);
        if (rows[0]) return rows[0];
      }
    }
    // The SaaS app host is only for the post-registration checkout bridge.
    // It has no tenant in its hostname, so never guess the first organization
    // for a user with multiple memberships.
    if (isAllokSaaSMode() && isSaaSAppHost(host)) {
      const rows = await getDb()
        .select({ organizationId: schema.member.organizationId, role: schema.member.role })
        .from(schema.member)
        .where(eq(schema.member.userId, userId))
        .limit(2);
      return rows.length === 1 ? rows[0] ?? null : null;
    }
    return resolveMembership(userId);
  }

  const db = getDb();
  const rows = await db
    .select({
      organizationId: schema.member.organizationId,
      role: schema.member.role,
    })
    .from(schema.member)
    .innerJoin(
      schema.organization,
      eq(schema.organization.id, schema.member.organizationId),
    )
    .where(
      and(
        eq(schema.member.userId, userId),
        eq(schema.organization.slug, slug),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function resolveLegacyOrganizationId(): Promise<string | null> {
  const db = getDb();
  const configured = process.env.ALLOK_LEGACY_ORGANIZATION_ID?.trim();
  const rows = await db
    .select({ id: schema.organization.id })
    .from(schema.organization)
    .where(configured
      ? eq(schema.organization.id, configured)
      : eq(schema.organization.slug, "principal"))
    .limit(1);
  return rows[0]?.id ?? null;
}

export async function resolveOrganizationIdForHost(
  host: string | null | undefined,
): Promise<string | null> {
  const slug = tenantSlugFromHost(host);
  if (!slug) return null;
  const db = getDb();
  const rows = await db
    .select({ id: schema.organization.id })
    .from(schema.organization)
    .where(eq(schema.organization.slug, slug))
    .limit(1);
  return rows[0]?.id ?? null;
}

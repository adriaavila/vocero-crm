import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { getAuth } from "@/lib/auth";

/**
 * Sesión + organización de Embedded Signup EN la app (fork).
 *
 * Meta solo permite un puñado de dominios fijos en Allowed Domains, así que
 * este flujo corre SIEMPRE en el host de la app (`appOrigin()`), nunca en el
 * subdominio del inquilino. Sin subdominio no hay de dónde inferir la
 * organización por host (como sí hace `requireSession`): el slug llega
 * explícito (`?org=<slug>`) y la membresía se resuelve DIRECTO contra ese
 * slug — "resolver por membresía, no por host" — sin la heurística de
 * "única membresía" que usa el bridge de checkout.
 */

export type SignupOwnerContext = {
  userId: string;
  organizationId: string;
  organizationSlug: string;
  organizationName: string;
};

export type ResolveOwnerResult =
  | { ok: true; context: SignupOwnerContext }
  | { ok: false; reason: "no_session" | "org_not_found" | "not_owner" };

export async function resolveOwnerForOrgSlug(
  requestHeaders: Headers,
  orgSlug: string,
): Promise<ResolveOwnerResult> {
  const session = await getAuth()
    .api.getSession({ headers: requestHeaders })
    .catch(() => null);
  if (!session) return { ok: false, reason: "no_session" };

  const rows = await getDb()
    .select({
      organizationId: schema.member.organizationId,
      role: schema.member.role,
      organizationName: schema.organization.name,
      organizationSlug: schema.organization.slug,
    })
    .from(schema.member)
    .innerJoin(schema.organization, eq(schema.organization.id, schema.member.organizationId))
    .where(and(eq(schema.member.userId, session.user.id), eq(schema.organization.slug, orgSlug)))
    .limit(1);

  const row = rows[0];
  if (!row || !row.organizationSlug) return { ok: false, reason: "org_not_found" };
  if (row.role !== "owner") return { ok: false, reason: "not_owner" };

  return {
    ok: true,
    context: {
      userId: session.user.id,
      organizationId: row.organizationId,
      organizationSlug: row.organizationSlug,
      organizationName: row.organizationName,
    },
  };
}

/**
 * Igual, pero solo confirma pertenencia (para `/complete`: ya hay un
 * `state.userId`/`state.orgId` firmados — esto re-verifica que ESA membresía
 * de owner sigue vigente, no vuelve a elegir organización).
 */
export async function isStillOwner(userId: string, organizationId: string): Promise<boolean> {
  const rows = await getDb()
    .select({ role: schema.member.role })
    .from(schema.member)
    .where(and(eq(schema.member.userId, userId), eq(schema.member.organizationId, organizationId)))
    .limit(1);
  return rows[0]?.role === "owner";
}

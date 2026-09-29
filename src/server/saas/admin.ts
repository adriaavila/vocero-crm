import { headers } from "next/headers";
import { count, desc } from "drizzle-orm";
import { getAuth } from "@/lib/auth";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { isAllokSaaSMode, isSaaSAdminEmail, isSaaSAdminHost } from "@/lib/tenant-host";
import {
  billingFromMetadata,
  getOrganizationForBilling,
  saveOrganizationBilling,
  type SaaSBillingState,
  type SaaSPlan,
} from "@/server/saas/billing";

export class SaaSAdminUnauthorized extends Error {
  constructor() {
    super("Panel SaaS no autorizado");
    this.name = "SaaSAdminUnauthorized";
  }
}

export type SaaSAdminIdentity = {
  userId: string;
  email: string;
  name: string;
};

export { isSaaSAdminEmail } from "@/lib/tenant-host";

export async function requireSaaSAdmin(
  action = "view_tenants",
  organizationId?: string,
): Promise<SaaSAdminIdentity> {
  if (!isAllokSaaSMode()) throw new SaaSAdminUnauthorized();
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  if (!isSaaSAdminHost(host)) throw new SaaSAdminUnauthorized();
  const session = await getAuth().api.getSession({ headers: requestHeaders });
  const email = session?.user.email ?? null;
  if (!session || !isSaaSAdminEmail(email)) throw new SaaSAdminUnauthorized();

  await getDb().insert(schema.saasAdminAudit).values({
    id: newId("saasAdminAudit"),
    userId: session.user.id,
    action,
    organizationId: organizationId ?? null,
  });
  return { userId: session.user.id, email: email!, name: session.user.name };
}

export type SaaSTenantStatus = {
  id: string;
  name: string;
  slug: string | null;
  createdAt: string;
  members: number;
  whatsapp: "connected" | "reconnect_required" | "not_connected";
  agentEnabled: boolean;
  billing: Pick<SaaSBillingState, "plan" | "status" | "source" | "subscriptionId">;
};

export async function listSaaSTenantStatus(): Promise<SaaSTenantStatus[]> {
  const db = getDb();
  const [organizations, members, credentials, profiles] = await Promise.all([
    db.select({ id: schema.organization.id, name: schema.organization.name, slug: schema.organization.slug, createdAt: schema.organization.createdAt, metadata: schema.organization.metadata })
      .from(schema.organization)
      .orderBy(desc(schema.organization.createdAt)),
    db.select({ organizationId: schema.member.organizationId, count: count() })
      .from(schema.member)
      .groupBy(schema.member.organizationId),
    db.select({ organizationId: schema.metaCredentials.organizationId, status: schema.metaCredentials.status })
      .from(schema.metaCredentials),
    db.select({ organizationId: schema.agentProfile.organizationId, enabled: schema.agentProfile.enabled })
      .from(schema.agentProfile),
  ]);
  const memberCount = new Map(members.map((row) => [row.organizationId, row.count]));
  const credentialStatus = new Map(credentials.map((row) => [row.organizationId, row.status]));
  const agentStatus = new Map(profiles.map((row) => [row.organizationId, row.enabled]));
  return organizations.map((organization) => ({
    id: organization.id,
    name: organization.name,
    slug: organization.slug,
    createdAt: organization.createdAt.toISOString(),
    members: memberCount.get(organization.id) ?? 0,
    whatsapp: credentialStatus.get(organization.id) ?? "not_connected",
    agentEnabled: agentStatus.get(organization.id) === true,
    billing: (({ plan, status, source, subscriptionId }) => ({ plan, status, source, subscriptionId }))(
      billingFromMetadata(organization.metadata)
    ),
  }));
}

/**
 * ¿Esta organización depende hoy de una suscripción de Stripe viva? Una
 * concesión manual nunca debe pisarla en silencio: si existe, el llamador
 * necesita `confirmOverrideStripe` a propósito. `canceled`/`inactive` no
 * cuentan — ahí ya no hay nada vigente que romper.
 */
function hasLiveStripeSubscription(billing: SaaSBillingState): boolean {
  return billing.subscriptionId !== null && billing.status !== "canceled" && billing.status !== "inactive";
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export type PlanGrantOutcome =
  | { ok: true; billing: SaaSBillingState }
  | { ok: false; reason: "stripe_subscription_active" }
  | { ok: false; reason: "not_found" };

/**
 * Alta manual de plan: el respaldo de "paga por link o transferencia" a la
 * concesión que hoy se hace con SQL a mano en producción (specs/018). Repetir
 * la llamada con el mismo plan es idempotente — vuelve a confirmar el mismo
 * estado, no crea historial nuevo. El resto queda auditado por
 * `requireSaaSAdmin` (acción + organización + admin), que el llamador debe
 * invocar antes de esto.
 */
export async function grantSaaSPlan(params: {
  organizationId: string;
  plan: SaaSPlan;
  adminEmail: string;
  confirmOverrideStripe: boolean;
}): Promise<PlanGrantOutcome> {
  const organization = await getOrganizationForBilling(params.organizationId);
  if (!organization) return { ok: false, reason: "not_found" };
  const current = billingFromMetadata(organization.metadata);
  if (hasLiveStripeSubscription(current) && !params.confirmOverrideStripe) {
    return { ok: false, reason: "stripe_subscription_active" };
  }
  const billing = await saveOrganizationBilling(params.organizationId, {
    plan: params.plan,
    status: "active",
    source: `manual_${todayIsoDate()}`,
    grantedBy: params.adminEmail,
    grantedAt: new Date().toISOString(),
  });
  return { ok: true, billing };
}

/**
 * Quita el acceso pagado sin borrar el historial: plan, fuente y quién lo
 * concedió se conservan a propósito (`grantedBy`/`grantedAt`/`source`), solo
 * cambia el estado a `canceled`. Repetirlo sobre un plan ya quitado es un
 * no-op seguro.
 */
export async function revokeSaaSPlan(params: {
  organizationId: string;
  confirmOverrideStripe: boolean;
}): Promise<PlanGrantOutcome> {
  const organization = await getOrganizationForBilling(params.organizationId);
  if (!organization) return { ok: false, reason: "not_found" };
  const current = billingFromMetadata(organization.metadata);
  if (hasLiveStripeSubscription(current) && !params.confirmOverrideStripe) {
    return { ok: false, reason: "stripe_subscription_active" };
  }
  const billing = await saveOrganizationBilling(params.organizationId, {
    status: "canceled",
  });
  return { ok: true, billing };
}

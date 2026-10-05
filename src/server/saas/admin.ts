import { headers } from "next/headers";
import { errorKeyForStep } from "@/lib/onboarding-errors";
import { count, desc } from "drizzle-orm";
import { getAuth } from "@/lib/auth";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { isAllokSaaSMode, isSaaSAdminEmail, isSaaSAdminHost } from "@/lib/tenant-host";
import { origenFromMetadata, type OrigenGuardado } from "@/lib/origen-alta";
import {
  billingFromMetadata,
  getOrganizationForBillingLocked,
  saveOrganizationBilling,
  type BillingHistoryEntry,
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

/** Host admin + sesión con email autorizado. No escribe auditoría (para eso, `auditSaaSAdminAction`). */
export async function requireSaaSAdminIdentity(): Promise<SaaSAdminIdentity> {
  if (!isAllokSaaSMode()) throw new SaaSAdminUnauthorized();
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  if (!isSaaSAdminHost(host)) throw new SaaSAdminUnauthorized();
  const session = await getAuth().api.getSession({ headers: requestHeaders });
  const email = session?.user.email ?? null;
  if (!session || !isSaaSAdminEmail(email)) throw new SaaSAdminUnauthorized();
  return { userId: session.user.id, email: email!, name: session.user.name };
}

export async function auditSaaSAdminAction(params: {
  userId: string;
  action: string;
  organizationId?: string | null;
  detail?: Record<string, unknown>;
}): Promise<void> {
  await getDb().insert(schema.saasAdminAudit).values({
    id: newId("saasAdminAudit"),
    userId: params.userId,
    action: params.action,
    organizationId: params.organizationId ?? null,
    detail: params.detail ? JSON.stringify(params.detail) : null,
  });
}

/**
 * Identidad + auditoría inmediata — para acciones sin resultado que esperar
 * (ver la lista de negocios). Una mutación con un resultado que auditar
 * (conceder/quitar plan) usa `requireSaaSAdminIdentity` sola y audita
 * después, con el detalle real: ver `grantSaaSPlan`/`revokeSaaSPlan`.
 */
export async function requireSaaSAdmin(
  action = "view_tenants",
  organizationId?: string,
): Promise<SaaSAdminIdentity> {
  const identity = await requireSaaSAdminIdentity();
  await auditSaaSAdminAction({ userId: identity.userId, action, organizationId });
  return identity;
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
  /** Fork (agencia): de dónde llegó el alta (`metadata.allok.origen`); null si no se anotó. */
  origen: OrigenGuardado | null;
  /** Alta de WhatsApp de autoservicio: dónde quedó, para soporte. */
  onboarding: {
    status: "pendiente" | "conectado" | "webhook_ok" | "primer_mensaje" | "error";
    errorKey: string | null;
    errorCode: string | null;
    errorDetail: string | null;
    cancelledAtStep: string | null;
    attempts: number;
    updatedAt: string;
    canRetry: boolean;
  } | null;
};

export async function listSaaSTenantStatus(): Promise<SaaSTenantStatus[]> {
  const db = getDb();
  const [organizations, members, credentials, profiles, onboardings] = await Promise.all([
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
    db.select().from(schema.whatsappOnboarding),
  ]);
  const onboardingByOrg = new Map(onboardings.map((row) => [row.organizationId, row]));
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
    onboarding: onboardingSummary(onboardingByOrg.get(organization.id), credentialStatus.has(organization.id)),
    origen: origenFromMetadata(organization.metadata),
  }));
}

function onboardingSummary(
  row: typeof schema.whatsappOnboarding.$inferSelect | undefined,
  hasCredentials: boolean,
): SaaSTenantStatus["onboarding"] {
  if (!row) return null;
  return {
    status: row.status,
    errorKey: row.status === "error" ? errorKeyForStep(row.errorStep) : null,
    errorCode: row.errorCode,
    errorDetail: row.errorDetail,
    cancelledAtStep: row.cancelledAtStep,
    attempts: row.attempts,
    updatedAt: row.updatedAt.toISOString(),
    canRetry: hasCredentials && row.status === "error",
  };
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

function pushHistory(current: BillingHistoryEntry[], entry: BillingHistoryEntry): BillingHistoryEntry[] {
  return [entry, ...current].slice(0, 10);
}

/** El patch de "desenganchar" una suscripción viva confirmada: nunca se cancela en Stripe, solo se deja de mirar. */
function detachPatch(current: SaaSBillingState): Partial<SaaSBillingState> {
  return {
    detachedSubscriptionId: current.subscriptionId,
    subscriptionId: null,
    priceId: null,
    currentPeriodEnd: null,
  };
}

export type PlanGrantOutcome =
  | { ok: true; billing: SaaSBillingState }
  | { ok: false; reason: "stripe_subscription_active" }
  | { ok: false; reason: "not_found" };

/**
 * Alta manual de plan: el respaldo de "paga por link o transferencia" a la
 * concesión que hoy se hace con SQL a mano en producción (specs/018).
 * Read-check-write dentro de una transacción con `SELECT ... FOR UPDATE`
 * (dos llamadas concurrentes sobre el mismo negocio no se pisan). Un negocio
 * inexistente no se audita (nada que auditar); todo lo demás sí, con el
 * resultado real — bloqueado por Stripe o concedido.
 */
export async function grantSaaSPlan(params: {
  organizationId: string;
  plan: SaaSPlan;
  adminEmail: string;
  adminUserId: string;
  confirmOverrideStripe: boolean;
}): Promise<PlanGrantOutcome> {
  const outcome = await getDb().transaction(async (tx) => {
    const organization = await getOrganizationForBillingLocked(params.organizationId, tx);
    if (!organization) return { ok: false as const, reason: "not_found" as const };
    const current = billingFromMetadata(organization.metadata);
    const live = hasLiveStripeSubscription(current);
    if (live && !params.confirmOverrideStripe) {
      return { ok: false as const, reason: "stripe_subscription_active" as const };
    }
    const entry: BillingHistoryEntry = {
      at: new Date().toISOString(),
      by: params.adminEmail,
      action: "grant",
      plan: params.plan,
      confirmOverrideStripe: params.confirmOverrideStripe,
    };
    const patch: Partial<SaaSBillingState> = {
      plan: params.plan,
      status: "active",
      source: `manual_${todayIsoDate()}`,
      grantedBy: params.adminEmail,
      grantedAt: new Date().toISOString(),
      history: pushHistory(current.history, entry),
      ...(live && params.confirmOverrideStripe ? detachPatch(current) : {}),
    };
    const billing = await saveOrganizationBilling(params.organizationId, patch, tx);
    return { ok: true as const, billing };
  });

  if (outcome.ok || outcome.reason !== "not_found") {
    await auditSaaSAdminAction({
      userId: params.adminUserId,
      action: "grant_plan",
      organizationId: params.organizationId,
      detail: {
        plan: params.plan,
        confirmOverrideStripe: params.confirmOverrideStripe,
        result: outcome.ok ? "ok" : outcome.reason,
      },
    });
  }
  return outcome;
}

/**
 * Quita el acceso pagado sin borrar el historial: plan, fuente y quién lo
 * concedió se conservan a propósito (`grantedBy`/`grantedAt`/`source`), solo
 * cambia el estado a `canceled` y queda quién/cuándo lo quitó
 * (`revokedBy`/`revokedAt`). Repetirlo sobre un plan ya quitado es un no-op
 * seguro. Misma transacción con bloqueo que `grantSaaSPlan`.
 */
export async function revokeSaaSPlan(params: {
  organizationId: string;
  adminEmail: string;
  adminUserId: string;
  confirmOverrideStripe: boolean;
}): Promise<PlanGrantOutcome> {
  const outcome = await getDb().transaction(async (tx) => {
    const organization = await getOrganizationForBillingLocked(params.organizationId, tx);
    if (!organization) return { ok: false as const, reason: "not_found" as const };
    const current = billingFromMetadata(organization.metadata);
    const live = hasLiveStripeSubscription(current);
    if (live && !params.confirmOverrideStripe) {
      return { ok: false as const, reason: "stripe_subscription_active" as const };
    }
    const entry: BillingHistoryEntry = {
      at: new Date().toISOString(),
      by: params.adminEmail,
      action: "revoke",
      plan: current.plan,
      confirmOverrideStripe: params.confirmOverrideStripe,
    };
    const patch: Partial<SaaSBillingState> = {
      status: "canceled",
      revokedBy: params.adminEmail,
      revokedAt: new Date().toISOString(),
      history: pushHistory(current.history, entry),
      ...(live && params.confirmOverrideStripe ? detachPatch(current) : {}),
    };
    const billing = await saveOrganizationBilling(params.organizationId, patch, tx);
    return { ok: true as const, billing };
  });

  if (outcome.ok || outcome.reason !== "not_found") {
    await auditSaaSAdminAction({
      userId: params.adminUserId,
      action: "revoke_plan",
      organizationId: params.organizationId,
      detail: {
        confirmOverrideStripe: params.confirmOverrideStripe,
        result: outcome.ok ? "ok" : outcome.reason,
      },
    });
  }
  return outcome;
}

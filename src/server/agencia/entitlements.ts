import { eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { isSaaSPlan, planMeetsTier } from "@/lib/saas-plans";
import { isAllokSaaSMode } from "@/lib/tenant-host";

/** Espejo de `SELF_SERVE_TRIAL_*` en `server/saas/billing` (sin importarlo: evita el ciclo). */
const SELF_SERVE_TRIAL_SOURCE = "self_serve_trial";
const SELF_SERVE_TRIAL_AI_REPLIES = 300;

type TrialFields = { source?: unknown; subscriptionId?: unknown; status?: unknown; currentPeriodEnd?: unknown };

/** Prueba de autoservicio vigente (sin suscripción de Stripe todavía). */
function isSelfServeTrialBilling(billing: TrialFields | null | undefined): boolean {
  return (
    billing?.source === SELF_SERVE_TRIAL_SOURCE &&
    !billing.subscriptionId &&
    billing.status === "trialing"
  );
}

/** La prueba de autoservicio vence sola por fecha: no hay Stripe que la cambie. */
export function selfServeTrialExpired(billing: TrialFields | null | undefined, now = new Date()): boolean {
  if (!isSelfServeTrialBilling(billing)) return false;
  const ends = typeof billing?.currentPeriodEnd === "string" ? Date.parse(billing.currentPeriodEnd) : NaN;
  return !Number.isFinite(ends) || ends <= now.getTime();
}

export type AutomationBillingStatus =
  | "incomplete"
  | "trialing"
  | "active"
  | "past_due"
  | "unpaid"
  | "canceled"
  | "inactive";

type Metadata = Record<string, unknown>;

/**
 * Por nivel: "pro" lo cumplen Completo Y Agencia (inmobiliaria), porque cada
 * plan incluye todo lo del anterior (ver `planMeetsTier`). El parámetro se
 * deja en el literal `"pro"` porque es el único umbral que pide hoy el
 * producto — nada impide ampliarlo a `SaaSPlan` si algún día hace falta
 * gatear específicamente por Agencia.
 */
export function hasPaidSaaSPlanFromMetadata(
  raw: string | null | undefined,
  plan: "pro",
  saasMode = isAllokSaaSMode(),
): boolean {
  if (!saasMode) return true;
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw) as {
      allok?: { billing?: { plan?: string; status?: string } & TrialFields };
    };
    const billing = parsed.allok?.billing;
    if (selfServeTrialExpired(billing)) return false;
    const currentPlan = isSaaSPlan(billing?.plan) ? billing.plan : null;
    return (
      planMeetsTier(currentPlan, plan) &&
      (billing?.status === "active" || billing?.status === "trialing")
    );
  } catch {
    return false;
  }
}

export function automationAccessFromMetadata(
  raw: string | null | undefined,
  saasMode = isAllokSaaSMode(),
): { allowed: boolean; status: AutomationBillingStatus } {
  if (!saasMode) return { allowed: true, status: "active" };
  if (!raw) return { allowed: false, status: "inactive" };

  let metadata: Metadata;
  try {
    const parsed: unknown = JSON.parse(raw);
    metadata = parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Metadata)
      : {};
  } catch {
    return { allowed: false, status: "inactive" };
  }

  const allok = metadata.allok;
  const billing =
    allok && typeof allok === "object" && !Array.isArray(allok)
      ? (allok as Metadata).billing
      : null;
  const status =
    billing && typeof billing === "object" && !Array.isArray(billing)
      ? (billing as Metadata).status
      : null;
  const normalized: AutomationBillingStatus =
    status === "trialing" || status === "active" || status === "past_due" ||
    status === "unpaid" || status === "canceled" || status === "incomplete"
      ? status
      : "inactive";

  if (selfServeTrialExpired(billing as TrialFields | null)) {
    return { allowed: false, status: "inactive" };
  }
  return {
    allowed: normalized === "active" || normalized === "trialing",
    status: normalized,
  };
}

/**
 * Tope de respuestas de IA de la prueba de autoservicio. Solo frena al
 * agente, nunca las respuestas a mano del dueño ni la conexión de WhatsApp.
 */
export async function trialAiQuotaReached(organizationId: string): Promise<boolean> {
  if (!isAllokSaaSMode()) return false;
  const db = getDb();
  const rows = await db
    .select({ metadata: schema.organization.metadata })
    .from(schema.organization)
    .where(eq(schema.organization.id, organizationId))
    .limit(1);
  let billing: TrialFields | null = null;
  try {
    billing = (JSON.parse(rows[0]?.metadata ?? "{}") as { allok?: { billing?: TrialFields } }).allok?.billing ?? null;
  } catch {
    return false;
  }
  if (!isSelfServeTrialBilling(billing)) return false;
  // Cuenta hasta el tope y para (`limit`): nunca recorre todo el historial
  // importado. El Laboratorio (conversaciones de prueba) no gasta el tope.
  const counted = await db.execute(sql`
    select count(*)::int as n from (
      select 1 from message m
      join conversation c on c.id = m.conversation_id and c.organization_id = m.organization_id
      where m.organization_id = ${organizationId}
        and m.origin = 'ai' and m.direction = 'out' and not c.is_test
      limit ${SELF_SERVE_TRIAL_AI_REPLIES}
    ) s`);
  const n = Number((counted as unknown as { n: number }[])[0]?.n ?? 0);
  return n >= SELF_SERVE_TRIAL_AI_REPLIES;
}

export async function canAutomate(organizationId: string): Promise<boolean> {
  if (!isAllokSaaSMode()) return true;
  const rows = await getDb()
    .select({ metadata: schema.organization.metadata })
    .from(schema.organization)
    .where(eq(schema.organization.id, organizationId))
    .limit(1);
  return automationAccessFromMetadata(rows[0]?.metadata).allowed;
}

export async function hasSaaSPlan(
  organizationId: string,
  plan: "pro",
): Promise<boolean> {
  if (!isAllokSaaSMode()) return true;
  const rows = await getDb()
    .select({ metadata: schema.organization.metadata })
    .from(schema.organization)
    .where(eq(schema.organization.id, organizationId))
    .limit(1);
  return hasPaidSaaSPlanFromMetadata(rows[0]?.metadata, plan);
}

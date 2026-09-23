import Stripe from "stripe";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { isAllokSaaSMode } from "@/lib/tenant-host";

export type SaaSPlan = "basic" | "pro";
export type SaaSBillingStatus =
  | "incomplete"
  | "trialing"
  | "active"
  | "past_due"
  | "unpaid"
  | "canceled"
  | "inactive";

export type SaaSBillingState = {
  plan: SaaSPlan | null;
  status: SaaSBillingStatus;
  customerId: string | null;
  subscriptionId: string | null;
  priceId: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  updatedAt: string | null;
};

type Metadata = Record<string, unknown>;

const API_VERSION = "2026-04-22.dahlia";

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

function billingMetadata(metadata: Metadata): Metadata {
  const allok = metadata.allok;
  const billing =
    allok && typeof allok === "object" && !Array.isArray(allok)
      ? (allok as Metadata).billing
      : null;
  return billing && typeof billing === "object" && !Array.isArray(billing)
    ? (billing as Metadata)
    : {};
}

function asPlan(value: unknown): SaaSPlan | null {
  return value === "basic" || value === "pro" ? value : null;
}

function asStatus(value: unknown): SaaSBillingStatus {
  return value === "incomplete" || value === "trialing" || value === "active" ||
    value === "past_due" || value === "unpaid" || value === "canceled"
    ? value
    : "inactive";
}

export function billingFromMetadata(raw: string | null | undefined): SaaSBillingState {
  const billing = billingMetadata(parseMetadata(raw));
  return {
    plan: asPlan(billing.plan),
    status: asStatus(billing.status),
    customerId: typeof billing.customerId === "string" ? billing.customerId : null,
    subscriptionId: typeof billing.subscriptionId === "string" ? billing.subscriptionId : null,
    priceId: typeof billing.priceId === "string" ? billing.priceId : null,
    currentPeriodEnd: typeof billing.currentPeriodEnd === "string" ? billing.currentPeriodEnd : null,
    cancelAtPeriodEnd: billing.cancelAtPeriodEnd === true,
    updatedAt: typeof billing.updatedAt === "string" ? billing.updatedAt : null,
  };
}

export function stripeForSaaS(): Stripe | null {
  if (!isAllokSaaSMode()) return null;
  const secret = process.env.ALLOK_SAAS_STRIPE_SECRET_KEY?.trim();
  return secret ? new Stripe(secret, { apiVersion: API_VERSION, maxNetworkRetries: 2 }) : null;
}

export function webhookSecretForSaaS(): string | null {
  return process.env.ALLOK_SAAS_STRIPE_WEBHOOK_SECRET?.trim() || null;
}

export function priceIdForPlan(plan: SaaSPlan): string | null {
  const value = plan === "basic"
    ? process.env.ALLOK_SAAS_STRIPE_BASIC_PRICE_ID
    : process.env.ALLOK_SAAS_STRIPE_PRO_PRICE_ID;
  return value?.trim() || null;
}

export function planForPriceId(priceId: string | null | undefined): SaaSPlan | null {
  if (!priceId) return null;
  if (priceId === process.env.ALLOK_SAAS_STRIPE_BASIC_PRICE_ID) return "basic";
  if (priceId === process.env.ALLOK_SAAS_STRIPE_PRO_PRICE_ID) return "pro";
  return null;
}

/**
 * Completo tienta con 7 días de prueba; Esencial cobra desde el día 1.
 * Una sola prueba por negocio: quien ya tuvo suscripción (aunque la cancelara
 * durante la prueba) vuelve pagando.
 */
export function trialDaysForPlan(plan: SaaSPlan, hadSubscription = false): number | undefined {
  return plan === "pro" && !hadSubscription ? 7 : undefined;
}

export function appOrigin(request: Request): string {
  return (
    process.env.ALLOK_SAAS_APP_URL?.trim() ||
    process.env.APP_BASE_URL?.trim() ||
    request.headers.get("origin") ||
    "http://localhost:3000"
  ).replace(/\/$/, "");
}

export async function getOrganizationBilling(organizationId: string): Promise<SaaSBillingState> {
  const rows = await getDb()
    .select({ metadata: schema.organization.metadata })
    .from(schema.organization)
    .where(eq(schema.organization.id, organizationId))
    .limit(1);
  return billingFromMetadata(rows[0]?.metadata);
}

export async function getOrganizationForBilling(organizationId: string) {
  const rows = await getDb()
    .select({ id: schema.organization.id, name: schema.organization.name, slug: schema.organization.slug, metadata: schema.organization.metadata })
    .from(schema.organization)
    .where(eq(schema.organization.id, organizationId))
    .limit(1);
  return rows[0] ?? null;
}

export function tenantOrigin(slug: string, request: Request): string {
  const forwardedHost = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const protocol = request.headers.get("x-forwarded-proto") ?? "http";
  if (forwardedHost && (
    forwardedHost === "localhost" ||
    forwardedHost.startsWith("localhost:") ||
    forwardedHost.endsWith(".localhost") ||
    forwardedHost.includes(".localhost:")
  )) {
    const port = forwardedHost.includes(":") ? `:${forwardedHost.split(":").at(-1)}` : "";
    return `${protocol}://${slug}.localhost${port}`;
  }
  const root = process.env.ALLOK_ROOT_DOMAIN?.trim() || "allok.fun";
  return `https://${slug}.${root}`;
}

export async function saveOrganizationBilling(
  organizationId: string,
  patch: Partial<SaaSBillingState>,
): Promise<SaaSBillingState> {
  const organization = await getOrganizationForBilling(organizationId);
  if (!organization) throw new Error("Organización no encontrada");
  const metadata = parseMetadata(organization.metadata);
  const current = billingFromMetadata(organization.metadata);
  const next = mergeBillingState(current, patch);
  metadata.allok = {
    ...(metadata.allok && typeof metadata.allok === "object" && !Array.isArray(metadata.allok)
      ? metadata.allok
      : {}),
    billing: next,
  };
  await getDb()
    .update(schema.organization)
    .set({ metadata: JSON.stringify(metadata) })
    .where(eq(schema.organization.id, organizationId));
  return next;
}

export function mergeBillingState(
  current: SaaSBillingState,
  patch: Partial<SaaSBillingState>,
): SaaSBillingState {
  const next: SaaSBillingState = {
    ...current,
    ...patch,
    updatedAt: patch.updatedAt ?? new Date().toISOString(),
  };
  // Stripe puede entregar eventos fuera de orden. El estado vigente gana por
  // fecha del evento, no por el orden en que llegaron al servidor.
  // `incomplete` es un marcador provisional escrito al crear Checkout; no
  // puede bloquear el primer webhook solo porque el reloj del servidor avanzó.
  if (current.status === "incomplete" && next.status !== "incomplete") return next;
  return current.updatedAt && next.updatedAt && Date.parse(next.updatedAt) < Date.parse(current.updatedAt)
    ? current
    : next;
}

export async function rememberBillingEvent(
  eventId: string,
  type: string,
  organizationId: string | null,
): Promise<boolean> {
  const inserted = await getDb()
    .insert(schema.saasBillingEvent)
    .values({ id: eventId, type, organizationId })
    .onConflictDoNothing()
    .returning({ id: schema.saasBillingEvent.id });
  return inserted.length > 0;
}

export async function hasRememberedBillingEvent(eventId: string): Promise<boolean> {
  const rows = await getDb()
    .select({ id: schema.saasBillingEvent.id })
    .from(schema.saasBillingEvent)
    .where(eq(schema.saasBillingEvent.id, eventId))
    .limit(1);
  return rows.length > 0;
}

export function statusFromStripe(status: Stripe.Subscription.Status): SaaSBillingStatus {
  return status === "trialing" || status === "active" || status === "past_due" ||
    status === "unpaid" || status === "canceled" || status === "incomplete"
    ? status
    : "inactive";
}

export function randomIntegrationSuffix(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz";
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

export function newBillingEventId(): string {
  return newId("saasBillingEvent");
}

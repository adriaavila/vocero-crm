import Stripe from "stripe";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { isAllokSaaSMode } from "@/lib/tenant-host";
import { isSaaSPlan } from "@/lib/saas-plans";

export type SaaSPlan = "basic" | "pro" | "inmobiliaria";
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
  /** Origen de la concesión manual (`manual_<YYYY-MM-DD>`) — null si nunca se concedió a mano. */
  source: string | null;
  /** Email del admin de allok que concedió el plan a mano por última vez. */
  grantedBy: string | null;
  /** Cuándo se concedió a mano por última vez. */
  grantedAt: string | null;
  /** Email del admin de allok que quitó el plan a mano por última vez. */
  revokedBy: string | null;
  /** Cuándo se quitó a mano por última vez. */
  revokedAt: string | null;
  /**
   * Id de la suscripción de Stripe que una concesión manual confirmada
   * desenganchó (nunca se cancela desde código — solo se deja de mirar).
   * El webhook la usa para ignorar eventos tardíos de esa suscripción vieja.
   */
  detachedSubscriptionId: string | null;
  /** Últimos 10 cambios manuales (alta/baja), el más reciente primero. */
  history: BillingHistoryEntry[];
};

export type BillingHistoryEntry = {
  at: string;
  by: string;
  action: "grant" | "revoke";
  plan: SaaSPlan | null;
  confirmOverrideStripe: boolean;
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
  return isSaaSPlan(value) ? value : null;
}

function asStatus(value: unknown): SaaSBillingStatus {
  return value === "incomplete" || value === "trialing" || value === "active" ||
    value === "past_due" || value === "unpaid" || value === "canceled"
    ? value
    : "inactive";
}

function asHistory(value: unknown): BillingHistoryEntry[] {
  if (!Array.isArray(value)) return [];
  const entries: BillingHistoryEntry[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const entry = raw as Record<string, unknown>;
    if (entry.action !== "grant" && entry.action !== "revoke") continue;
    if (typeof entry.at !== "string" || typeof entry.by !== "string") continue;
    entries.push({
      at: entry.at,
      by: entry.by,
      action: entry.action,
      plan: asPlan(entry.plan),
      confirmOverrideStripe: entry.confirmOverrideStripe === true,
    });
  }
  return entries.slice(0, 10);
}

export function billingFromMetadata(raw: string | null | undefined): SaaSBillingState {
  const billing = billingMetadata(parseMetadata(raw));
  // La prueba de autoservicio no tiene Stripe que la cierre: vencida, se lee
  // como "inactive" en todo el producto (Facturación ofrece los planes, el
  // checkout la deja pagar, el menú deja de mostrar Completo).
  const trialExpired =
    billing.source === SELF_SERVE_TRIAL_SOURCE &&
    typeof billing.subscriptionId !== "string" &&
    billing.status === "trialing" &&
    !(typeof billing.currentPeriodEnd === "string" && Date.parse(billing.currentPeriodEnd) > Date.now());
  return {
    plan: asPlan(billing.plan),
    status: trialExpired ? "inactive" : asStatus(billing.status),
    customerId: typeof billing.customerId === "string" ? billing.customerId : null,
    subscriptionId: typeof billing.subscriptionId === "string" ? billing.subscriptionId : null,
    priceId: typeof billing.priceId === "string" ? billing.priceId : null,
    currentPeriodEnd: typeof billing.currentPeriodEnd === "string" ? billing.currentPeriodEnd : null,
    cancelAtPeriodEnd: billing.cancelAtPeriodEnd === true,
    updatedAt: typeof billing.updatedAt === "string" ? billing.updatedAt : null,
    source: typeof billing.source === "string" ? billing.source : null,
    grantedBy: typeof billing.grantedBy === "string" ? billing.grantedBy : null,
    grantedAt: typeof billing.grantedAt === "string" ? billing.grantedAt : null,
    revokedBy: typeof billing.revokedBy === "string" ? billing.revokedBy : null,
    revokedAt: typeof billing.revokedAt === "string" ? billing.revokedAt : null,
    detachedSubscriptionId: typeof billing.detachedSubscriptionId === "string" ? billing.detachedSubscriptionId : null,
    history: asHistory(billing.history),
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
    : plan === "pro"
      ? process.env.ALLOK_SAAS_STRIPE_PRO_PRICE_ID
      : process.env.ALLOK_SAAS_STRIPE_INMO_PRICE_ID;
  return value?.trim() || null;
}

export function planForPriceId(priceId: string | null | undefined): SaaSPlan | null {
  if (!priceId) return null;
  if (priceId === process.env.ALLOK_SAAS_STRIPE_BASIC_PRICE_ID) return "basic";
  if (priceId === process.env.ALLOK_SAAS_STRIPE_PRO_PRICE_ID) return "pro";
  if (priceId === process.env.ALLOK_SAAS_STRIPE_INMO_PRICE_ID) return "inmobiliaria";
  return null;
}

/**
 * Completo tienta con 7 días de prueba; Esencial y Agencia cobran desde el
 * día 1. Una sola prueba por negocio: quien ya tuvo suscripción (aunque la
 * cancelara durante la prueba) vuelve pagando.
 */
export function trialDaysForPlan(plan: SaaSPlan, hadSubscription = false): number | undefined {
  return plan === "pro" && !hadSubscription ? 7 : undefined;
}

/**
 * `request` es opcional: en un Server Component no hay `Request` a mano, y las
 * dos variables de entorno ya deciden en casi todo caso real (el header solo
 * importa como último respaldo dentro de un route handler).
 */
export function appOrigin(request?: Request): string {
  return (
    process.env.ALLOK_SAAS_APP_URL?.trim() ||
    process.env.APP_BASE_URL?.trim() ||
    request?.headers.get("origin") ||
    "http://localhost:3000"
  ).replace(/\/$/, "");
}

type Db = ReturnType<typeof getDb>;
/** El tipo de `tx` que entrega `db.transaction(async (tx) => ...)` — misma interfaz de consultas que `Db`. */
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type DbOrTx = Db | Tx;

export async function getOrganizationBilling(organizationId: string, db: DbOrTx = getDb()): Promise<SaaSBillingState> {
  const rows = await db
    .select({ metadata: schema.organization.metadata })
    .from(schema.organization)
    .where(eq(schema.organization.id, organizationId))
    .limit(1);
  return billingFromMetadata(rows[0]?.metadata);
}

export async function getOrganizationForBilling(organizationId: string, db: DbOrTx = getDb()) {
  const rows = await db
    .select({ id: schema.organization.id, name: schema.organization.name, slug: schema.organization.slug, metadata: schema.organization.metadata })
    .from(schema.organization)
    .where(eq(schema.organization.id, organizationId))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Igual que `getOrganizationForBilling`, pero con `SELECT ... FOR UPDATE`:
 * solo tiene efecto dentro de una transacción (`getDb().transaction(...)`).
 * Usado por la concesión/baja manual de plan para que dos llamadas
 * concurrentes sobre el mismo negocio no se pisen (lee-decide-escribe).
 */
export async function getOrganizationForBillingLocked(organizationId: string, tx: Tx) {
  const rows = await tx
    .select({ id: schema.organization.id, name: schema.organization.name, slug: schema.organization.slug, metadata: schema.organization.metadata })
    .from(schema.organization)
    .where(eq(schema.organization.id, organizationId))
    .for("update");
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
  db: DbOrTx = getDb(),
): Promise<SaaSBillingState> {
  const organization = await getOrganizationForBilling(organizationId, db);
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
  await db
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

/**
 * ¿Este negocio ya tuvo alguna vez una suscripción real o una concesión
 * manual? Cualquiera de las dos cuenta para no regalar una segunda prueba
 * gratis a quien pagó por link/transferencia y ahora pasa por checkout.
 */
export function hadPriorSubscription(current: SaaSBillingState): boolean {
  return (
    current.subscriptionId !== null ||
    current.grantedAt !== null ||
    current.source === SELF_SERVE_TRIAL_SOURCE
  );
}

/**
 * Prueba de autoservicio (decisión de Adrian, 2026-09-30): quien se registra
 * solo conecta WhatsApp gratis y tiene 7 días de Completo, con tope de 300
 * respuestas de IA. Sin Stripe: termina sola por fecha (`currentPeriodEnd`).
 * Deja de ser "prueba de autoservicio" en cuanto existe una suscripción.
 */
export const SELF_SERVE_TRIAL_SOURCE = "self_serve_trial";
export const SELF_SERVE_TRIAL_DAYS = 7;
export const SELF_SERVE_TRIAL_AI_REPLIES = 300;

/**
 * Checkout se niega solo con una suscripción de Stripe viva. La prueba de
 * autoservicio (vigente o vencida) siempre puede pagar.
 */
export function checkoutBlocked(billing: Pick<SaaSBillingState, "source" | "subscriptionId" | "status">): boolean {
  return (billing.status === "active" || billing.status === "trialing") && !isSelfServeTrial(billing);
}

export function isSelfServeTrial(
  billing: Pick<SaaSBillingState, "source" | "subscriptionId" | "status">,
): boolean {
  return (
    billing.source === SELF_SERVE_TRIAL_SOURCE &&
    billing.subscriptionId === null &&
    billing.status === "trialing"
  );
}

export async function startSelfServeTrial(
  organizationId: string,
  now = new Date(),
  db: DbOrTx = getDb(),
): Promise<SaaSBillingState> {
  const ends = new Date(now.getTime() + SELF_SERVE_TRIAL_DAYS * 24 * 60 * 60 * 1000);
  return saveOrganizationBilling(
    organizationId,
    {
      plan: "pro",
      status: "trialing",
      source: SELF_SERVE_TRIAL_SOURCE,
      currentPeriodEnd: ends.toISOString(),
      updatedAt: now.toISOString(),
    },
    db,
  );
}

/**
 * ¿Este evento de `customer.subscription.*` es de la suscripción vigente (o
 * la primera que ve esta organización)? Una concesión manual confirmada
 * desengancha la suscripción vieja (`detachedSubscriptionId`) sin cancelarla
 * en Stripe: si ese evento tardío llega después, no debe resucitarla ni
 * pisar la concesión. También cubre el caso de una suscripción activa
 * distinta (`current.subscriptionId` ya apunta a otra).
 */
export function isCurrentOrFirstSubscriptionEvent(current: SaaSBillingState, incomingSubscriptionId: string): boolean {
  return (
    current.subscriptionId === incomingSubscriptionId ||
    (current.subscriptionId === null && current.detachedSubscriptionId !== incomingSubscriptionId)
  );
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

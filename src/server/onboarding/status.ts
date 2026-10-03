import { and, eq, gte, ne, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { errorKeyForStep, type OnboardingErrorKey } from "@/lib/onboarding-errors";
import { activateNumber, finishActivation, metaErrorSink } from "@/server/agencia/whatsapp-signup/complete";
import { getPhoneNameStatus } from "@/server/agencia/whatsapp-signup/graph";
import { getCredentialsByOrg } from "@/server/whatsapp/credentials";
import { ensureOnboarding, getOnboarding, markError, type OnboardingStatus } from "./whatsapp-onboarding";

/** Pasos que se reintentan con el token guardado, sin abrir otra vez Meta. */
const SERVER_RETRY_STEPS = new Set([
  "webhook",
  "webhook_verify",
  "register",
  "register_not_verified",
  "register_limit",
  "register_pin_mismatch",
]);

export type OnboardingView = {
  status: OnboardingStatus;
  mode: "coexistence" | "cloud_api" | null;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  errorKey: OnboardingErrorKey | null;
  cancelledAtStep: string | null;
  connectedAt: string | null;
  webhookOkAt: string | null;
  firstMessageAt: string | null;
  /** Reintentar sirve sin volver a abrir la ventana de Meta. */
  canRetryActivation: boolean;
  /** Solo con `withMeta`: estado del nombre visible según Meta. */
  nameStatus?: string | null;
};

/**
 * Qué prueba hay de que el número funciona («por verificar» si no hay ninguna,
 * que no es lo mismo que «roto»), contando solo desde la última vez que se
 * conectó: un mensaje de antes de reconectar no demuestra nada sobre
 * esta conexión.
 *
 * Recibido = un mensaje entrante real de WhatsApp. Entregado = una respuesta
 * que allok envió (el agente, el equipo desde el CRM o una plantilla) y que
 * WhatsApp marcó como entregada o leída: aceptada por la API no basta, y un
 * eco de lo escrito en la app del teléfono no es nuestro envío. Ni el
 * Laboratorio ni el historial importado cuentan: no son tráfico en vivo.
 */
export async function getConnectionEvidence(
  organizationId: string,
  since: Date | null,
): Promise<{ lastInboundAt: Date | null; lastDeliveredAt: Date | null }> {
  const m = schema.message;
  const c = schema.conversation;
  const rows = await getDb()
    .select({
      lastInboundAt: sql<string | Date | null>`max(case when ${m.direction} = 'in' then ${m.createdAt} end)`,
      lastDeliveredAt: sql<string | Date | null>`max(case when ${m.direction} = 'out'
        and ${m.status} in ('delivered', 'read')
        and ${m.origin} in ('ai', 'operator', 'template') then ${m.createdAt} end)`,
    })
    .from(m)
    .innerJoin(c, and(eq(c.id, m.conversationId), eq(c.organizationId, m.organizationId)))
    .where(
      and(
        scoped(m.organizationId, organizationId),
        eq(c.channel, "whatsapp"),
        eq(c.isTest, false),
        ne(m.origin, "history"),
        since ? gte(m.createdAt, since) : undefined,
      ),
    );
  const toDate = (value: string | Date | null | undefined) => (value ? new Date(value) : null);
  return { lastInboundAt: toDate(rows[0]?.lastInboundAt), lastDeliveredAt: toDate(rows[0]?.lastDeliveredAt) };
}

export async function getOnboardingView(
  organizationId: string,
  options: { withMeta?: boolean } = {},
): Promise<OnboardingView> {
  await ensureOnboarding(organizationId);
  const [row, creds] = await Promise.all([getOnboarding(organizationId), getCredentialsByOrg(organizationId)]);
  const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
  const view: OnboardingView = {
    status: row?.status ?? "pendiente",
    mode: row?.mode ?? null,
    displayPhoneNumber: creds?.displayPhoneNumber ?? null,
    verifiedName: creds?.verifiedName ?? null,
    errorKey: row?.status === "error" ? errorKeyForStep(row.errorStep) : null,
    cancelledAtStep: row?.cancelledAtStep ?? null,
    connectedAt: iso(row?.connectedAt),
    webhookOkAt: iso(row?.webhookOkAt),
    firstMessageAt: iso(row?.firstMessageAt),
    canRetryActivation: Boolean(
      creds && row?.status === "error" && row.errorStep && SERVER_RETRY_STEPS.has(row.errorStep)
    ),
  };
  if (options.withMeta && creds) {
    view.nameStatus = await getPhoneNameStatus(creds.phoneNumberId, creds.token).catch(() => null);
  }
  return view;
}

/**
 * "Reintentar" después de que el número ya quedó guardado: vuelve a suscribir
 * el webhook y, si es número nuevo, a registrarlo, con el token guardado.
 * Lo usan el dueño (wizard) y soporte (admin).
 */
export async function retryActivation(
  organizationId: string,
): Promise<{ ok: true } | { ok: false; status: number; step: string }> {
  const [row, creds] = await Promise.all([getOnboarding(organizationId), getCredentialsByOrg(organizationId)]);
  if (!creds) return { ok: false, status: 409, step: "not_connected" };
  const sink = metaErrorSink();
  const result = await activateNumber(
    {
      organizationId,
      wabaId: creds.wabaId,
      phoneNumberId: creds.phoneNumberId,
      token: creds.token,
      mode: row?.mode ?? "coexistence",
    },
    sink.log,
  );
  if (!result.ok) {
    const meta = sink.last();
    await markError(organizationId, { step: result.step, code: meta?.code ?? null, detail: meta?.detail ?? null });
    return { ok: false, status: result.status, step: result.step };
  }
  await finishActivation({
    organizationId,
    phoneNumberId: creds.phoneNumberId,
    token: creds.token,
    mode: row?.mode ?? "coexistence",
  });
  return { ok: true };
}

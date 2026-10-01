import { errorKeyForStep, type OnboardingErrorKey } from "@/lib/onboarding-errors";
import { activateNumber, metaErrorSink } from "@/server/agencia/whatsapp-signup/complete";
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
  return { ok: true };
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Loader2, RotateCw } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { onboardingErrorCopy } from "@/lib/onboarding-errors";

export type OnboardingPanelView = {
  status: "pendiente" | "conectado" | "webhook_ok" | "primer_mensaje" | "error";
  mode: "coexistence" | "cloud_api" | null;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  errorKey: string | null;
  cancelledAtStep: string | null;
  firstMessageAt: string | null;
  canRetryActivation: boolean;
  nameStatus?: string | null;
};

/** `current_step` de Meta → dónde quedó, en palabras del dueño. */
const META_STEP: Record<string, string> = {
  BUSINESS_ACCOUNT_SELECTION: "elegir tu empresa",
  WABA_PHONE_PROFILE_PICKER: "elegir tu cuenta y tu número",
  WHATSAPP_BUSINESS_PROFILE_SETUP: "crear tu perfil de WhatsApp",
  PHONE_NUMBER_SETUP: "agregar tu número",
  PHONE_NUMBER_VERIFICATION: "verificar tu número",
  PERMISSIONS: "aceptar los permisos",
};

/**
 * Alta de WhatsApp en el subdominio del negocio: cuando algo se cae a la mitad
 * (cerraron la ventana de Meta, un permiso, un número de otro proveedor) dice
 * qué pasó en palabras del dueño, retoma donde quedó y termina de activar un
 * número ya guardado sin abrir Meta otra vez.
 *
 * Solo dibuja el ERROR. El número conectado y las pruebas de que funciona
 * (recibimos / enviamos) viven en una sola tarjeta, `ConnectionCard`, que
 * `whatsapp-wizard.tsx` dibuja a partir de las credenciales.
 */
export function WhatsappOnboardingPanel({
  bridgeUrl,
  onShowConnectChange,
  onViewChange,
  onChanged,
}: {
  bridgeUrl: string;
  /** El botón «Conectar WhatsApp» del wizard solo compite cuando no hay un error que retomar. */
  onShowConnectChange?: (show: boolean) => void;
  /** El estado del alta, para quien dibuja el resto de la pantalla. */
  onViewChange?: (view: OnboardingPanelView) => void;
  /** Un reintento pudo cambiar la conexión. */
  onChanged?: () => void;
}) {
  const [view, setView] = useState<OnboardingPanelView | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);

  const load = useCallback(
    async (withMeta = false) => {
      const res = await fetch(`/api/onboarding/whatsapp${withMeta ? "?meta=1" : ""}`, { cache: "no-store" }).catch(() => null);
      if (!res?.ok) return null;
      const data = (await res.json().catch(() => null)) as OnboardingPanelView | null;
      if (data) setView((prev) => ({ ...data, nameStatus: data.nameStatus ?? prev?.nameStatus }));
      return data?.status ?? null;
    },
    [],
  );

  useEffect(() => {
    void load(true);
    // Una sola carga al montar: el panel ya no espera mensajes, solo cuenta un error.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (view) onViewChange?.(view);
  }, [view, onViewChange]);

  // pendiente, o un error que no se arregla reintentando (otro número, otra cuenta):
  // ahí el wizard muestra su "Conectar WhatsApp". En los demás estados la acción
  // vive en este panel o en la tarjeta del número.
  const showConnect =
    view !== null && (view.status === "pendiente" || (view.status === "error" && !onboardingErrorCopy(view.errorKey).retry));
  useEffect(() => {
    if (view) onShowConnectChange?.(showConnect);
  }, [view, showConnect, onShowConnectChange]);

  async function retry() {
    if (!view?.canRetryActivation) {
      window.location.assign(bridgeUrl);
      return;
    }
    setRetrying(true);
    setRetryError(null);
    const res = await fetch("/api/onboarding/whatsapp/retry", { method: "POST" }).catch(() => null);
    const data = (await res?.json().catch(() => null)) as { ok?: boolean; errorKey?: string } | null;
    setRetrying(false);
    if (!res?.ok || !data?.ok) {
      setRetryError(onboardingErrorCopy(data?.errorKey).body);
    }
    await load();
    onChanged?.();
  }

  if (!view || view.status !== "error") return null;

  const copy = onboardingErrorCopy(view.errorKey);
  const where = view.cancelledAtStep ? META_STEP[view.cancelledAtStep] : null;
  return (
    <Card className="border-warning-soft">
      <CardHeader>
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning-text" aria-hidden="true" />
          <div>
            <CardTitle className="text-base">{copy.title}</CardTitle>
            <CardDescription className="mt-1">
              {copy.body}
              {where ? ` La última vez llegaste hasta ${where}.` : ""}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 sm:flex-row">
        {copy.action && (
          <a href={copy.action.href} target="_blank" rel="noreferrer" className={buttonVariants({ className: "min-h-11" })}>
            {copy.action.label}
          </a>
        )}
        {copy.retry && (
          <Button type="button" variant={copy.action ? "outline" : "default"} className="min-h-11" disabled={retrying} onClick={() => void retry()}>
            {retrying ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            ) : (
              <RotateCw className="mr-2 h-4 w-4" aria-hidden="true" />
            )}
            {view.canRetryActivation ? "Terminar la conexión" : "Seguir donde quedé"}
          </Button>
        )}
        {retryError && (
          <p role="alert" className="text-sm text-danger-text sm:self-center">
            {retryError}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

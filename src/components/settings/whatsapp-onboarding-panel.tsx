"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, CheckCircle2, Info, Loader2, MessageCircle, RotateCw } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useEvents } from "@/components/use-events";
import { META_PAYMENT_URL, WHATSAPP_MANAGER_URL, onboardingErrorCopy } from "@/lib/onboarding-errors";

type View = {
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

type FirstMessage = { text: string | null };

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
 * Alta de WhatsApp en el subdominio del negocio: retoma donde quedó, termina
 * de activar un número ya guardado sin abrir Meta otra vez, y cierra con
 * "mándale un mensaje a tu número" viendo llegar el mensaje en vivo.
 */
export function WhatsappOnboardingPanel({ bridgeUrl }: { bridgeUrl: string }) {
  const [view, setView] = useState<View | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const [firstMessage, setFirstMessage] = useState<FirstMessage | null>(null);

  const load = useCallback(async (withMeta = false) => {
    const res = await fetch(`/api/onboarding/whatsapp${withMeta ? "?meta=1" : ""}`, { cache: "no-store" }).catch(() => null);
    if (!res?.ok) return null;
    const data = (await res.json().catch(() => null)) as View | null;
    if (data) setView((prev) => ({ ...data, nameStatus: data.nameStatus ?? prev?.nameStatus }));
    return data?.status ?? null;
  }, []);

  useEffect(() => {
    void load(true);
  }, [load]);

  // Respaldo del SSE (proxy que corta, pestaña dormida): un sondeo lento
  // mientras se espera el primer mensaje.
  const waiting = view?.status === "conectado" || view?.status === "webhook_ok";
  useEffect(() => {
    if (!waiting) return;
    const id = window.setInterval(() => void load(), 10_000);
    return () => window.clearInterval(id);
  }, [waiting, load]);

  useEvents({
    onMessageNew: ({ message }) => {
      // Solo mientras se espera el primer mensaje del número recién conectado.
      if (!waiting) return;
      const m = message as { direction?: string; text?: string | null };
      if (m.direction !== "in") return;
      // El servidor decide (solo WhatsApp cuenta): un mensaje de Instagram o
      // Messenger no cierra el alta.
      // El evento sale antes de que se marque el alta: si aún no, un reintento.
      const show = (status: string | null) => {
        if (status === "primer_mensaje") setFirstMessage((prev) => prev ?? { text: m.text ?? null });
        return status;
      };
      void load().then(show).then((status) => {
        if (status !== "primer_mensaje") window.setTimeout(() => void load().then(show), 1500);
      });
    },
  });

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
  }

  if (!view || view.status === "pendiente") return null;

  if (view.status === "error") {
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
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <RotateCw className="mr-2 h-4 w-4" aria-hidden="true" />
              )}
              {view.canRetryActivation ? "Terminar de activar" : "Seguir donde quedé"}
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

  const number = view.displayPhoneNumber ?? "tu número";
  const nameNotice =
    view.nameStatus === "PENDING_REVIEW"
      ? "Meta está revisando el nombre que verán tus clientes. Mientras tanto puedes recibir y responder mensajes."
      : view.nameStatus === "DECLINED"
        ? "Meta rechazó el nombre visible de tu número. Cámbialo en WhatsApp Manager; tus mensajes siguen funcionando."
        : null;

  if (view.status === "primer_mensaje") {
    return (
      <Card className="border-success-soft">
        <CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" aria-hidden="true" />
            <div>
              <p className="font-medium" role="status">
                {firstMessage ? "¡Llegó tu primer mensaje!" : "WhatsApp conectado y recibiendo mensajes"}
              </p>
              <p className="text-sm text-text-3">
                {firstMessage?.text ? `"${firstMessage.text.slice(0, 80)}"` : number}
              </p>
            </div>
          </div>
          <Link href="/inbox" className={buttonVariants({ className: "min-h-11" })}>
            Ver en la bandeja <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </CardContent>
        {nameNotice && <Notice text={nameNotice} href={WHATSAPP_MANAGER_URL} label="Abrir WhatsApp Manager" />}
      </Card>
    );
  }

  // conectado / webhook_ok: el último paso es ver llegar un mensaje real.
  return (
    <Card className="border-brand-soft bg-brand-tint">
      <CardHeader>
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand text-brand-fg">
            <MessageCircle className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <CardTitle>Último paso: mándale un mensaje a {number}</CardTitle>
            <CardDescription className="mt-1">
              {view.mode === "coexistence"
                ? "Escríbele desde otro teléfono, no desde el del negocio. Lo verás aparecer aquí."
                : "Escríbele desde cualquier WhatsApp. Lo verás aparecer aquí."}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="flex items-center gap-2 text-sm text-text-2" role="status">
          <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          Esperando tu mensaje…
        </p>
        {nameNotice && <p className="text-sm text-text-3">{nameNotice}</p>}
        <p className="flex items-start gap-2 text-xs text-text-3">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>
            Para escribirle tú primero a un cliente (plantillas), Meta pide un método de pago en tu cuenta.{" "}
            <a href={META_PAYMENT_URL} target="_blank" rel="noreferrer" className="font-medium text-foreground underline-offset-2 hover:underline">
              Agrégalo aquí
            </a>
            .
          </span>
        </p>
      </CardContent>
    </Card>
  );
}

function Notice({ text, href, label }: { text: string; href: string; label: string }) {
  return (
    <div className="border-t border-border px-5 py-3 text-sm text-text-3">
      {text}{" "}
      <a href={href} target="_blank" rel="noreferrer" className="font-medium text-foreground underline-offset-2 hover:underline">
        {label}
      </a>
    </div>
  );
}

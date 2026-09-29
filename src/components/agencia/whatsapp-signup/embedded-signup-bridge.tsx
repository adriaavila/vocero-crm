"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowRight, CheckCircle2, Loader2, MessageCircle, RotateCw, Smartphone } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Bridge de Embedded Signup EN la app (fork). Puerto de
 * `allok-fun/src/components/whatsapp/EmbeddedSignupClient.tsx`: mismo SDK,
 * mismos parámetros de `FB.login`, mismo listener de `postMessage`, y el
 * mismo `exchangeWhenReady` (code + ids del evento, o descubrimiento del
 * servidor a los 2.5s si los ids nunca llegan) — el intercambio de código y
 * todo lo demás vive en el servidor (`/api/whatsapp/embedded-signup/complete`),
 * nunca en el navegador.
 *
 * "Éxito" se muestra SOLO tras un /complete que devolvió ok:true en ESTA
 * sesión de la pestaña — nunca por el solo hecho de que `/config` reporte una
 * fila de credenciales existente (esa fila puede tener el webhook sin
 * confirmar). Con una conexión existente, el botón dice "Reconectar" y, si
 * hace falta, se muestra el aviso de qué quedó pendiente.
 */

declare global {
  interface Window {
    fbAsyncInit?: () => void;
    FB?: {
      init: (config: object) => void;
      login: (callback: (response: FBLoginResponse) => void, options: object) => void;
    };
  }
}

interface FBLoginResponse {
  authResponse?: { code?: string };
  status?: string;
  error?: string;
  error_code?: string | number;
  error_message?: string;
  error_reason?: string;
}

type SignupEvent = {
  type?: string;
  event?: string;
  version?: number;
  data?: {
    phone_number_id?: string;
    waba_id?: string;
    business_id?: string;
    current_step?: string;
    error_message?: string;
  };
};

type Mode = "coexistence" | "cloud_api";

type ExistingConnection = {
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  status: string;
  needsAttention: boolean;
  needsAttentionMessage: string | null;
};

type Config = {
  appId: string;
  configId?: string;
  cloudApiConfigId?: string;
  graphVersion: string;
  mode: Mode;
  state: string;
  cloudApiAvailable: boolean;
  connection: ExistingConnection | null;
};

type Status = "loading" | "choose_mode" | "opening" | "processing" | "success" | "error";

type ErrorKind =
  | "cancelled"
  | "missing_permissions"
  | "phone_in_use"
  | "meta_error"
  | "plan_inactive"
  | "session_expired"
  | "generic";

type SuccessDetails = { displayPhoneNumber: string | null; verifiedName: string | null; mode: Mode };

type Pending = {
  code?: string;
  wabaId?: string;
  phoneNumberId?: string;
  businessId?: string;
  event?: SignupEvent;
};

/** Solo Meta puede mandar el evento de Embedded Signup — nunca la propia página. */
function isMetaMessageOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return url.protocol === "https:" && (url.hostname === "facebook.com" || url.hostname.endsWith(".facebook.com"));
  } catch {
    return false;
  }
}

function parseSignupEvent(data: unknown): SignupEvent | null {
  try {
    return typeof data === "string" ? JSON.parse(data) : (data as SignupEvent);
  } catch {
    return null;
  }
}

export function EmbeddedSignupBridge({
  orgSlug,
  organizationName,
}: {
  orgSlug: string;
  organizationName: string;
}) {
  const [mode, setMode] = useState<Mode>("coexistence");
  const [config, setConfig] = useState<Config | null>(null);
  const [sdkReady, setSdkReady] = useState(false);
  const [status, setStatus] = useState<Status>("loading");
  const [errorKind, setErrorKind] = useState<ErrorKind>("generic");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [success, setSuccess] = useState<SuccessDetails | null>(null);
  const [redirectTo, setRedirectTo] = useState<string | null>(null);

  const pendingRef = useRef<Pending>({});
  const exchangeStartedRef = useRef(false);
  const stateRef = useRef<string>("");
  const configRef = useRef<Config | null>(null);
  const modeRef = useRef<Mode>("coexistence");

  const loadConfig = useCallback(async (nextMode: Mode) => {
    setStatus("loading");
    setErrorMessage(null);
    exchangeStartedRef.current = false;
    pendingRef.current = {};
    try {
      const res = await fetch(
        `/api/whatsapp/embedded-signup/config?org=${encodeURIComponent(orgSlug)}&mode=${nextMode}`,
        { cache: "no-store" }
      );
      const data = (await res.json().catch(() => ({}))) as Config & { error?: string; message?: string };
      if (!res.ok) {
        setStatus("error");
        setErrorMessage(data.message ?? "No pudimos preparar la conexión con Meta.");
        setErrorKind(
          data.error === "billing_inactive"
            ? "plan_inactive"
            : data.error === "session_expired"
              ? "session_expired"
              : "generic"
        );
        return;
      }
      setConfig(data);
      configRef.current = data;
      stateRef.current = data.state;
      setStatus("choose_mode");
      loadFbSdk(data);
    } catch {
      setStatus("error");
      setErrorKind("generic");
      setErrorMessage("No pudimos conectar con el servidor. Revisa tu conexión e intenta de nuevo.");
    }
  }, [orgSlug]);

  function loadFbSdk(cfg: Config) {
    const initialize = () => {
      window.FB?.init({ appId: cfg.appId, autoLogAppEvents: true, xfbml: true, version: cfg.graphVersion });
      setSdkReady(true);
    };
    window.fbAsyncInit = initialize;
    if (window.FB) {
      initialize();
      return;
    }
    const existing = document.getElementById("facebook-jssdk");
    if (existing) {
      existing.addEventListener("load", initialize, { once: true });
      return;
    }
    const script = document.createElement("script");
    script.id = "facebook-jssdk";
    script.src = "https://connect.facebook.net/en_US/sdk.js";
    script.async = true;
    script.defer = true;
    script.crossOrigin = "anonymous";
    document.body.appendChild(script);
  }

  /**
   * Puerto de `exchangeWhenReady` (allok-fun): dispara con code + ids del
   * evento del SDK; si el código llegó por `FB.login` pero los ids nunca
   * aparecieron por `postMessage`, un timeout de 2.5s la vuelve a llamar con
   * `allowServerDiscovery=true` para que el servidor los descubra solo.
   */
  const exchangeWhenReady = useCallback(async (allowServerDiscovery = false) => {
    const pending = pendingRef.current;
    const cfg = configRef.current;
    if (
      exchangeStartedRef.current ||
      !pending.code ||
      !cfg ||
      (!allowServerDiscovery && (!pending.wabaId || !pending.phoneNumberId))
    ) {
      return;
    }
    exchangeStartedRef.current = true;
    setStatus("processing");
    setErrorMessage(null);

    const res = await fetch("/api/whatsapp/embedded-signup/complete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        code: pending.code,
        state: stateRef.current,
        wabaId: pending.wabaId,
        phoneNumberId: pending.phoneNumberId,
        businessId: pending.businessId,
        mode: modeRef.current,
        event: pending.event,
      }),
    }).catch(() => null);
    const data = (await res?.json().catch(() => ({}))) as
      | { ok: true; displayPhoneNumber: string | null; verifiedName: string | null; mode: Mode; redirectTo?: string }
      | { error?: string; step?: string }
      | null;

    if (!res?.ok || !data || !("ok" in data) || !data.ok) {
      exchangeStartedRef.current = false;
      setStatus("error");
      const step = data && "step" in data ? data.step : undefined;
      const message = (data && "error" in data ? data.error : null) ?? "Meta no pudo completar la conexión.";
      setErrorMessage(message);
      setErrorKind(
        step === "permissions"
          ? "missing_permissions"
          : step === "phone_in_use"
            ? "phone_in_use"
            : step === "state" || step === "session" || step === "membership"
              ? "session_expired"
              : "meta_error"
      );
      return;
    }

    setSuccess({ displayPhoneNumber: data.displayPhoneNumber, verifiedName: data.verifiedName, mode: data.mode });
    setRedirectTo(data.redirectTo ?? null);
    setStatus("success");
  }, []);

  useEffect(() => {
    void loadConfig(mode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (!isMetaMessageOrigin(event.origin)) return;
      const signupEvent = parseSignupEvent(event.data);
      if (signupEvent?.type !== "WA_EMBEDDED_SIGNUP") return;

      if (signupEvent.event === "CANCEL") {
        exchangeStartedRef.current = false;
        setStatus("error");
        setErrorKind("cancelled");
        setErrorMessage(signupEvent.data?.error_message ?? "Cancelaste la conexión antes de terminar.");
        return;
      }
      const wabaId = signupEvent.data?.waba_id;
      const phoneNumberId = signupEvent.data?.phone_number_id;
      if (!wabaId || !phoneNumberId) return;
      pendingRef.current = {
        ...pendingRef.current,
        wabaId,
        phoneNumberId,
        businessId: signupEvent.data?.business_id,
        event: signupEvent,
      };
      void exchangeWhenReady();
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [exchangeWhenReady]);

  function onModeChange(next: Mode) {
    if (status === "processing" || status === "opening") return;
    setMode(next);
    modeRef.current = next;
    void loadConfig(next);
  }

  function launch() {
    if (!window.FB || !config) return;
    setStatus("opening");
    setErrorMessage(null);
    const cloudApi = mode === "cloud_api";
    window.FB.login(
      (response: FBLoginResponse) => {
        const code = response.authResponse?.code;
        if (!code) {
          setStatus("error");
          setErrorKind(response.status === "not_authorized" ? "cancelled" : "meta_error");
          setErrorMessage(
            response.error_message ??
              (response.status === "not_authorized"
                ? "Meta no autorizó la conexión."
                : "Meta no devolvió un código de autorización. Vuelve a intentar.")
          );
          return;
        }
        pendingRef.current = { ...pendingRef.current, code };
        void exchangeWhenReady();
        // Los ids del evento pueden no llegar nunca (Meta a veces solo manda
        // el code): a los 2.5s se intenta igual, dejando que el servidor los
        // descubra por los scopes granulares del token.
        window.setTimeout(() => void exchangeWhenReady(true), 2500);
      },
      {
        config_id: cloudApi ? config.cloudApiConfigId : config.configId,
        auth_type: "rerequest",
        response_type: "code",
        override_default_response_type: true,
        return_scopes: true,
        scope: "whatsapp_business_management,whatsapp_business_messaging",
        state: config.state,
        extras: {
          setup: {},
          ...(cloudApi ? {} : { featureType: "whatsapp_business_app_onboarding" }),
          sessionInfoVersion: "3",
        },
      }
    );
  }

  const existing = config?.connection ?? null;
  const isReconnect = Boolean(existing);
  const statusAnnouncement = statusAnnouncementFor(status, errorKind, success);

  return (
    <div className="mx-auto w-full max-w-md">
      <div className="mb-6 text-center">
        <p className="kicker text-text-3">Conexión de WhatsApp</p>
        <h1 className="mt-1 text-xl font-[680] tracking-tight">{organizationName}</h1>
      </div>

      {/* Región viva única: cada estado anuncia su titular a quien usa lector de pantalla. */}
      <div aria-live="polite" className="sr-only">
        {statusAnnouncement}
      </div>

      <Card>
        {status === "loading" && (
          <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
            <Loader2 className="h-6 w-6 animate-spin text-text-3" aria-hidden="true" />
            <p className="text-sm text-text-2">Cargando la conexión segura de Meta…</p>
          </CardContent>
        )}

        {(status === "choose_mode" || status === "opening") && config && (
          <>
            <CardHeader>
              <CardTitle>{isReconnect ? "Reconecta tu WhatsApp" : "Conecta tu WhatsApp"}</CardTitle>
              <CardDescription>
                {isReconnect
                  ? "Ya hay un número guardado para este negocio. Elige el modo y vuelve a conectar."
                  : "Elige cómo quieres conectar tu número."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {existing?.needsAttention && (
                <div className="flex items-start gap-2 rounded-lg border border-warning-soft bg-warning-tint p-3 text-sm text-warning-text">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <p>
                    {existing.needsAttentionMessage ?? "Falta activar la recepción de mensajes."} Vuelve a
                    conectar para terminarlo.
                  </p>
                </div>
              )}
              <div role="radiogroup" aria-label="Modo de conexión" className="space-y-3">
                <ModeOption
                  icon={Smartphone}
                  title="Ya uso WhatsApp Business en mi teléfono"
                  description="Recomendado. Conservas la app en tu celular; Vocero recibe los mensajes en paralelo."
                  selected={mode === "coexistence"}
                  onSelect={() => onModeChange("coexistence")}
                />
                {config.cloudApiAvailable && (
                  <ModeOption
                    icon={MessageCircle}
                    title="Número nuevo"
                    description="Para un número que todavía no usas en WhatsApp Business."
                    selected={mode === "cloud_api"}
                    onSelect={() => onModeChange("cloud_api")}
                  />
                )}
              </div>
              <Button
                type="button"
                className="mt-2 w-full min-h-11"
                disabled={!sdkReady || status === "opening"}
                onClick={launch}
              >
                {status === "opening" ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                    Abriendo Meta…
                  </>
                ) : !sdkReady ? (
                  "Cargando Meta…"
                ) : (
                  <>
                    {isReconnect ? "Reconectar" : "Conectar WhatsApp"} <ArrowRight className="ml-2 h-4 w-4" />
                  </>
                )}
              </Button>
            </CardContent>
          </>
        )}

        {status === "processing" && (
          <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
            <Loader2 className="h-6 w-6 animate-spin text-brand" aria-hidden="true" />
            <p className="text-sm font-medium">Estamos conectando tu número.</p>
            {mode === "coexistence" && (
              <p className="text-sm text-text-3">Deja WhatsApp Business abierto en tu teléfono.</p>
            )}
          </CardContent>
        )}

        {status === "success" && success && (
          <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-success-tint text-success">
              <CheckCircle2 className="h-6 w-6" aria-hidden="true" />
            </span>
            <div>
              <p className="font-medium text-success-text">
                {success.verifiedName ?? "WhatsApp conectado"}
              </p>
              <p className="text-sm text-text-3">{success.displayPhoneNumber ?? "Número conectado"}</p>
            </div>
            {redirectTo ? (
              <a href={redirectTo} className={buttonVariants({ className: "mt-2 min-h-11 w-full" })}>
                Volver a mi CRM <ArrowRight className="ml-2 h-4 w-4" />
              </a>
            ) : (
              <p className="text-sm text-text-3">Ya puedes volver a Vocero.</p>
            )}
          </CardContent>
        )}

        {status === "error" && (
          <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-danger-tint text-destructive">
              <AlertTriangle className="h-6 w-6" aria-hidden="true" />
            </span>
            <p className="font-medium text-danger-text">{errorTitle(errorKind)}</p>
            <p className="text-sm text-text-3">{errorMessage ?? "Vuelve a intentar en unos minutos."}</p>
            {errorKind !== "plan_inactive" && errorKind !== "phone_in_use" && (
              <Button type="button" variant="outline" className="mt-2 min-h-11 w-full" onClick={() => void loadConfig(mode)}>
                <RotateCw className="mr-2 h-4 w-4" aria-hidden="true" />
                Reintentar
              </Button>
            )}
          </CardContent>
        )}
      </Card>
    </div>
  );
}

function statusAnnouncementFor(status: Status, errorKind: ErrorKind, success: SuccessDetails | null): string {
  switch (status) {
    case "loading":
      return "Cargando la conexión segura de Meta.";
    case "choose_mode":
      return "Elige cómo conectar tu WhatsApp.";
    case "opening":
      return "Abriendo Meta.";
    case "processing":
      return "Conectando tu número.";
    case "success":
      return success ? `WhatsApp conectado: ${success.displayPhoneNumber ?? ""}` : "WhatsApp conectado.";
    case "error":
      return errorTitle(errorKind);
    default:
      return "";
  }
}

function errorTitle(kind: ErrorKind): string {
  switch (kind) {
    case "cancelled":
      return "Conexión cancelada";
    case "missing_permissions":
      return "Faltan permisos en Meta";
    case "phone_in_use":
      return "Número ya conectado a otro negocio";
    case "plan_inactive":
      return "Activa tu plan";
    case "session_expired":
      return "Tu sesión de conexión expiró";
    default:
      return "No pudimos completar la conexión";
  }
}

function ModeOption({
  icon: Icon,
  title,
  description,
  selected,
  onSelect,
}: {
  icon: typeof Smartphone;
  title: string;
  description: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={`flex w-full min-h-11 items-start gap-3 rounded-lg border p-3 text-left transition-colors duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${
        selected ? "border-brand bg-brand-tint" : "border-border-strong hover:border-foreground"
      }`}
    >
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${selected ? "text-brand-text" : "text-text-3"}`} aria-hidden="true" />
      <span>
        <span className="block text-sm font-medium">{title}</span>
        <span className="mt-0.5 block text-xs text-text-3">{description}</span>
      </span>
    </button>
  );
}

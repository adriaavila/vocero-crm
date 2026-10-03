"use client";

import { useCallback, useEffect, useState } from "react";
import { WhatsappOnboardingPanel, type OnboardingPanelView } from "@/components/settings/whatsapp-onboarding-panel";
import { AlertTriangle, ArrowRight, Copy, Info, Sparkles, ShieldCheck } from "lucide-react";
import { ConnectionCard, type ConnectionEvidence } from "@/components/agencia/whatsapp-conexion";
import { SetupProgressNav } from "@/components/agencia/setup-progress";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useEvents } from "@/components/use-events";
import { WHATSAPP_MANAGER_URL } from "@/lib/onboarding-errors";
import type { SetupProgress } from "@/server/agencia/setup-progress";

type Connection = {
  wabaId: string;
  phoneNumberId: string;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  status: "connected" | "reconnect_required";
  tokenLast4: string;
};

type WebhookInfo = {
  url: string;
  verifyToken: string;
  isHttps: boolean;
  signatureLayer: boolean;
};

export function shouldShowHandoverRecovery(
  guidedAvailable: boolean,
  connection: Connection | null,
): boolean {
  return guidedAvailable && connection?.status !== "reconnect_required";
}

/** Meta avisa del nombre visible del número; en palabras del dueño. */
function nameNotice(status: string | null | undefined): React.ReactNode {
  if (status === "PENDING_REVIEW") {
    return "Meta está revisando el nombre que verán tus clientes. Mientras tanto puedes recibir y responder mensajes.";
  }
  if (status === "DECLINED") {
    return (
      <>
        Meta rechazó el nombre visible de tu número. Cámbialo en{" "}
        <a href={WHATSAPP_MANAGER_URL} target="_blank" rel="noreferrer" className="font-medium text-foreground underline-offset-2 hover:underline">
          WhatsApp Manager
        </a>
        ; tus mensajes siguen funcionando.
      </>
    );
  }
  return null;
}

export function WhatsappWizard({
  saasMode = false,
  guidedAvailable = false,
  bridgeUrl = null,
  initialProgress = null,
  brandName = "allok",
}: {
  saasMode?: boolean;
  guidedAvailable?: boolean;
  /** Fork — Embedded Signup en la app: URL del bridge (`/conectar-whatsapp`
   *  en el host de la app) con `?org=` ya armado. null = usar el enlace
   *  guiado de allok.fun (fallback) o, sin ninguno, solo el formulario manual. */
  bridgeUrl?: string | null;
  /** El avance de la puesta en marcha, resuelto en el servidor (solo el dueño lo ve). */
  initialProgress?: SetupProgress | null;
  /** Marca del despliegue, en la forma que se escribe dentro de una oración. */
  brandName?: string;
}) {
  const [connection, setConnection] = useState<Connection | null>(null);
  const [evidence, setEvidence] = useState<ConnectionEvidence | null>(null);
  const [webhook, setWebhook] = useState<WebhookInfo | null>(null);
  const [progress, setProgress] = useState<SetupProgress | null>(initialProgress);
  const [view, setView] = useState<OnboardingPanelView | null>(null);
  const [loaded, setLoaded] = useState(false);
  // Con un alta en curso (esperando mensaje, error reintentable, conectado) la
  // acción vive en el panel; aquí no se repite "Conectar WhatsApp".
  const [showConnect, setShowConnect] = useState(true);

  const refetch = useCallback(async () => {
    const [c, w, setup] = await Promise.all([
      fetch("/api/settings/whatsapp").then((r) => (r.ok ? r.json() : null)),
      // En SaaS el webhook lo mueve el alta sola y la ruta responde 404.
      saasMode ? null : fetch("/api/settings/webhook").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/setup", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)),
    ]).catch(() => [null, null, null]);
    if (c) {
      setConnection(c.connection);
      setEvidence(c.evidence ?? null);
    }
    if (w) setWebhook(w);
    if (setup?.progress) setProgress(setup.progress);
    setLoaded(true);
  }, [saasMode]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  // Que llegue un mensaje, o que WhatsApp entregue una respuesta, es justo la
  // prueba que esta pantalla muestra: se refresca sola, sin recargar.
  useEvents({
    onMessageNew: () => void refetch(),
    onMessageStatus: ({ status }) => {
      if (status === "delivered" || status === "read") void refetch();
    },
  });

  if (!loaded) {
    return (
      <div className="max-w-3xl">
        <Card>
          <CardHeader>
            <Skeleton className="h-5 w-36" />
            <Skeleton className="h-4 w-full max-w-md" />
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-1.5">
              <Skeleton className="h-3.5 w-16" />
              <Skeleton className="h-9 w-full max-w-sm" />
            </div>
            <div className="space-y-1.5">
              <Skeleton className="h-3.5 w-24" />
              <Skeleton className="h-9 w-full max-w-sm" />
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const connected = connection?.status === "connected";
  const reconnect = connection?.status === "reconnect_required";
  const hasGuidedOption = Boolean(bridgeUrl) || guidedAvailable;
  // Sin conexión guiada, el formulario manual es la única puerta: va abierto.
  // Con ella (o ya conectado) es soporte, y queda cerrado.
  const manualOpen = !hasGuidedOption && !connected;
  const number = connection?.displayPhoneNumber ?? connection?.phoneNumberId ?? "tu número";

  return (
    <div className="max-w-3xl space-y-6">
      <header>
        <h1 className="text-2xl font-[680] tracking-tight">
          {connected ? "Tu WhatsApp está conectado" : reconnect ? "Reconecta tu WhatsApp" : "Conecta el WhatsApp de tu negocio"}
        </h1>
        <p className="mt-2 max-w-xl text-sm leading-6 text-text-2">
          {connected
            ? "Revisa que los mensajes lleguen y que tus respuestas salgan. Cada cosa se confirma sola."
            : reconnect
              ? "La conexión venció y tus respuestas están en pausa. Vuelve a conectar el mismo número; tus conversaciones siguen aquí."
              : "Un solo paso: eliges tu número en la ventana de Meta. Si ya usas WhatsApp Business en tu teléfono, lo sigues usando igual."}
        </p>
        {progress && <SetupProgressNav progress={progress} page="whatsapp" className="mt-6 max-w-2xl" />}
      </header>

      {saasMode && bridgeUrl && (
        <WhatsappOnboardingPanel
          bridgeUrl={bridgeUrl}
          onShowConnectChange={setShowConnect}
          onViewChange={setView}
          onChanged={() => void refetch()}
        />
      )}

      {!connection && bridgeUrl && showConnect && (
        <BridgeConnectCard
          bridgeUrl={bridgeUrl}
          title="Conecta tu WhatsApp"
          description="Conectas con Meta, la empresa dueña de WhatsApp. Si ya usas WhatsApp Business en tu teléfono, lo sigues usando."
          label="Conectar WhatsApp"
        />
      )}
      {!connection && !bridgeUrl && guidedAvailable && (
        <GuidedConnectCard
          onRecovered={() => void refetch()}
          connection={connection}
          guidedAvailable={guidedAvailable}
          brandName={brandName}
        />
      )}

      {reconnect && (
        <Card className="border-danger-soft">
          <CardHeader>
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" aria-hidden="true" />
              <div>
                <CardTitle>Tus respuestas están en pausa</CardTitle>
                <CardDescription className="mt-1">
                  La conexión con {number} venció. Reconéctala para que {brandName} vuelva a responder y a recibir mensajes.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {bridgeUrl ? (
              <ActionButton onAct={() => window.location.assign(bridgeUrl)} label="Reconectar WhatsApp" pending="Abriendo…" />
            ) : guidedAvailable ? (
              <GuidedButton label="Reconectar WhatsApp" />
            ) : (
              <p className="text-sm text-text-2">
                Abre «Conexión manual (soporte)» más abajo y pide ayuda a quien administra tu instancia.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {connected && (
        <ConnectionCard
          number={number}
          businessName={connection?.verifiedName ?? null}
          evidence={evidence}
          progress={progress}
          changeNumberHref={bridgeUrl}
          notice={nameNotice(view?.nameStatus)}
          footer={
            shouldShowHandoverRecovery(guidedAvailable, connection) && !bridgeUrl ? (
              <HandoverRecovery connected onDone={() => void refetch()} brandName={brandName} />
            ) : null
          }
        />
      )}

      <details open={manualOpen || undefined} className="group rounded-lg border border-border bg-card">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 py-2 text-sm font-medium text-text-2 [&::-webkit-details-marker]:hidden">
          <span>Conexión manual (soporte)</span>
          <span aria-hidden className="text-text-3 transition-transform group-open:rotate-90 motion-reduce:transition-none">
            <ArrowRight className="h-4 w-4" />
          </span>
        </summary>
        <div className="space-y-6 border-t border-border p-4">
          <p className="text-sm leading-6 text-text-3">
            Solo para soporte: conecta un número con sus credenciales de WhatsApp Cloud API en vez de la ventana de Meta.
          </p>
          <ConnectForm
            existing={connection}
            onSaved={() => void refetch()}
            hasGuidedOption={hasGuidedOption}
          />
          {/* El override de Embedded Signup y el enlace guiado ya mueven el
              webhook solos; en SaaS mostrar el verify token de la instancia
              entera es una superficie que sobra (y hoy la ve cualquier
              miembro, ver el fix owner-only en la ruta). */}
          {webhook && !saasMode && <WebhookCard webhook={webhook} />}
        </div>
      </details>
    </div>
  );
}

/** Un botón de una acción que tarda: se desactiva y dice qué hace. */
function ActionButton({ onAct, label, pending }: { onAct: () => void; label: string; pending: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      type="button"
      className="min-h-11 w-full sm:w-auto"
      disabled={busy}
      onClick={() => {
        setBusy(true);
        onAct();
      }}
    >
      {busy ? pending : label}
      <ArrowRight className="h-4 w-4" aria-hidden="true" />
    </Button>
  );
}

function BridgeConnectCard({
  bridgeUrl,
  title,
  description,
  label,
}: {
  bridgeUrl: string;
  title: string;
  description: string;
  label: string;
}) {
  return (
    <Card className="overflow-hidden border-brand-soft bg-brand-tint">
      <CardHeader>
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand text-brand-fg"><Sparkles className="h-5 w-5" /></span>
          <div>
            <CardTitle>{title}</CardTitle>
            <CardDescription className="mt-1">{description}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <ActionButton onAct={() => window.location.assign(bridgeUrl)} label={label} pending="Abriendo…" />
        <p className="mt-3 text-xs text-text-3">Se abre una ventana segura de Meta y vuelves aquí al terminar.</p>
      </CardContent>
    </Card>
  );
}

/** El enlace guiado de allok.fun: pide la URL al servidor y manda al dueño allá. */
function GuidedButton({ label }: { label: string }) {
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <Button
        type="button"
        className="min-h-11 w-full sm:w-auto"
        disabled={connecting}
        onClick={async () => {
          setConnecting(true);
          setError(null);
          const response = await fetch("/api/saas/whatsapp/onboarding-link", { method: "POST" }).catch(() => null);
          const payload = (await response?.json().catch(() => null)) as { url?: string; error?: { message?: string } } | null;
          if (response?.ok && payload?.url) {
            window.location.assign(payload.url);
            return;
          }
          setConnecting(false);
          setError(payload?.error?.message ?? "La conexión guiada aún no está disponible.");
        }}
      >
        {connecting ? "Preparando conexión…" : label}
        <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </Button>
      {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
    </>
  );
}

function GuidedConnectCard({
  onRecovered,
  connection,
  guidedAvailable,
  brandName,
}: {
  onRecovered: () => void;
  connection: Connection | null;
  guidedAvailable: boolean;
  brandName: string;
}) {
  return (
    <Card className="overflow-hidden border-brand-soft bg-brand-tint">
      <CardHeader>
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand text-brand-fg"><Sparkles className="h-5 w-5" /></span>
          <div>
            <CardTitle>Conecta tu WhatsApp</CardTitle>
            <CardDescription className="mt-1">Usas el flujo oficial de Meta. No copias nada y conservas tu WhatsApp Business cuando es compatible.</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <GuidedButton label="Conectar WhatsApp" />
        <p className="mt-3 text-xs text-text-3">Se abre una ventana segura de Meta y vuelves aquí al terminar.</p>
        {shouldShowHandoverRecovery(guidedAvailable, connection) && (
          <HandoverRecovery connected={Boolean(connection)} onDone={onRecovered} brandName={brandName} />
        )}
      </CardContent>
    </Card>
  );
}

/**
 * El alta puede caerse DESPUÉS de conectar el número en Meta: ahí el número ya
 * es suyo y reconectarlo es justo lo que no hay que hacer. Este botón repite
 * solo la entrega.
 */
function HandoverRecovery({ connected, onDone, brandName }: { connected: boolean; onDone: () => void; brandName: string }) {
  const [retrying, setRetrying] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  return (
    <div className="mt-4 border-t border-border pt-4">
      <p className="text-xs text-text-3">
        {connected
          ? `¿Tu número aparece conectado, pero ${brandName} no recibe mensajes? Vuelve a sincronizar la conexión sin reconectarlo.`
          : "¿Ya conectaste tu número con Meta y no aparece aquí?"}
      </p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="mt-2 min-h-11"
        disabled={retrying}
        onClick={async () => {
          setRetrying(true);
          setNotice(null);
          const response = await fetch("/api/saas/whatsapp/retry-connection", { method: "POST" }).catch(() => null);
          const payload = (await response?.json().catch(() => null)) as { error?: { message?: string } } | null;
          setRetrying(false);
          if (response?.ok) {
            setNotice(connected ? "Listo: volvimos a sincronizar la conexión." : "Listo: tu número quedó conectado.");
            onDone();
            return;
          }
          setNotice(payload?.error?.message ?? "No se pudo recuperar la conexión.");
        }}
      >
        {retrying ? "Recuperando…" : "Recuperar mi conexión"}
      </Button>
      {notice && <p role="status" className="mt-2 text-sm text-text-2">{notice}</p>}
    </div>
  );
}

function ConnectForm({
  existing,
  onSaved,
  hasGuidedOption,
}: {
  existing: Connection | null;
  onSaved: () => void;
  hasGuidedOption: boolean;
}) {
  const [wabaId, setWabaId] = useState(existing?.wabaId ?? "");
  const [phoneNumberId, setPhoneNumberId] = useState(
    existing?.phoneNumberId ?? ""
  );
  const [token, setToken] = useState("");
  const [testResult, setTestResult] = useState<
    | { ok: true; display: string }
    | { ok: false; message: string }
    | null
  >(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const canTest = wabaId.trim() && phoneNumberId.trim() && token.trim();

  async function test() {
    setTesting(true);
    setTestResult(null);
    const res = await fetch("/api/settings/whatsapp/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phoneNumberId, token }),
    }).catch(() => null);
    setTesting(false);
    if (!res) {
      setTestResult({ ok: false, message: "Sin conexión con el servidor" });
      return;
    }
    const data = (await res.json().catch(() => null)) as {
      displayPhoneNumber?: string;
      error?: { message?: string };
    } | null;
    if (res.ok && data?.displayPhoneNumber) {
      setTestResult({ ok: true, display: data.displayPhoneNumber });
    } else {
      setTestResult({
        ok: false,
        message: data?.error?.message ?? "La validación falló",
      });
    }
  }

  async function save() {
    setSaving(true);
    setSaveError(null);
    const res = await fetch("/api/settings/whatsapp", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ wabaId, phoneNumberId, token }),
    }).catch(() => null);
    setSaving(false);
    if (!res?.ok) {
      const data = (await res?.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setSaveError(data?.error?.message ?? "No se pudo guardar la conexión");
      return;
    }
    setToken("");
    setTestResult(null);
    onSaved();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {existing
            ? "Reconectar / actualizar el número"
            : hasGuidedOption
              ? "Conexión manual (respaldo)"
              : "Conectar tu número de WhatsApp"}
        </CardTitle>
        <CardDescription>
          Pega las credenciales de WhatsApp Cloud API. El token se valida
          contra Meta ANTES de guardarse y se almacena cifrado.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 rounded-md border bg-background p-4 text-sm">
          <p className="font-medium">¿De dónde sale el token?</p>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-md border p-3">
              <p className="mb-1 font-medium text-primary">Modo directo</p>
              <p className="text-muted-foreground">
                El negocio tiene su propia app en{" "}
                <span className="text-foreground">developers.facebook.com</span>:
                usa un token de <span className="text-foreground">usuario del sistema</span>{" "}
                (no expira) con permisos de WhatsApp. En este modo conviene
                configurar también el App Secret para la firma del webhook.
              </p>
            </div>
            <div className="rounded-md border p-3">
              <p className="mb-1 font-medium text-primary">Modo agencia (Tech Provider)</p>
              <p className="text-muted-foreground">
                Tu agencia hace el Embedded Signup en SU plataforma y su
                backend obtiene el token del cliente; te lo entrega para
                pegarlo aquí. El webhook se conecta con el{" "}
                <span className="text-foreground">override por WABA</span>{" "}
                (checklist de 5 pasos en el README).
              </p>
            </div>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="waba-id">WABA ID</Label>
            <Input
              id="waba-id"
              placeholder="ID de la cuenta de WhatsApp Business"
              value={wabaId}
              onChange={(e) => setWabaId(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="phone-number-id">Phone Number ID</Label>
            <Input
              id="phone-number-id"
              placeholder="ID del número de teléfono"
              value={phoneNumberId}
              onChange={(e) => setPhoneNumberId(e.target.value)}
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="token">Token de acceso</Label>
          <Input
            id="token"
            type="password"
            placeholder={existing ? `Guardado (…${existing.tokenLast4}) — pega uno nuevo para cambiarlo` : "EAAG…"}
            value={token}
            onChange={(e) => {
              setToken(e.target.value);
              setTestResult(null);
            }}
          />
        </div>

        {testResult && (
          <p
            className={`text-sm ${testResult.ok ? "text-success" : "text-destructive"}`}
          >
            {testResult.ok
              ? `✓ Token válido para ${testResult.display}. Ya puedes guardar.`
              : testResult.message}
          </p>
        )}
        {saveError && <p className="text-sm text-destructive">{saveError}</p>}

        <div className="flex gap-2">
          <Button
            variant="outline"
            disabled={!canTest || testing}
            onClick={() => void test()}
          >
            {testing ? "Probando…" : "Probar conexión"}
          </Button>
          <Button
            disabled={!testResult?.ok || saving}
            onClick={() => void save()}
          >
            {saving ? "Guardando…" : "Guardar conexión"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function WebhookCard({ webhook }: { webhook: WebhookInfo }) {
  const [copied, setCopied] = useState<string | null>(null);

  function copy(text: string, which: string) {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(which);
      setTimeout(() => setCopied(null), 1500);
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Webhook de WhatsApp</CardTitle>
        <CardDescription>
          Pega estos valores en el panel de Meta (modo directo) o úsalos en el
          override de tu backend de agencia (a nivel WABA).{" "}
          <strong className="text-foreground">
            Guarda la conexión ANTES de configurar el webhook:
          </strong>{" "}
          la verificación (handshake) funciona sin guardar, pero los mensajes
          solo se reciben si la conexión está guardada — se enrutan por tu
          Phone Number ID.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!webhook.isHttps && (
          <p className="flex items-start gap-2 rounded-md border border-warning-soft bg-warning-tint p-3 text-xs text-warning-text">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            La URL configurada no es https: Meta exige https para los webhooks.
            Ajusta APP_BASE_URL con tu dominio público.
          </p>
        )}
        <div className="space-y-1.5">
          <Label>URL del webhook (callback URL)</Label>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-md border bg-background px-3 py-2 text-xs">
              {webhook.url}
            </code>
            <Button
              variant="outline"
              size="icon"
              aria-label="Copiar URL"
              onClick={() => copy(webhook.url, "url")}
            >
              <Copy className="h-4 w-4" />
            </Button>
            {copied === "url" && (
              <span className="text-xs text-primary">Copiada ✓</span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            La URL contiene el token secreto en la ruta: trátala como una
            contraseña.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label>Verify token</Label>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-md border bg-background px-3 py-2 text-xs">
              {webhook.verifyToken}
            </code>
            <Button
              variant="outline"
              size="icon"
              aria-label="Copiar verify token"
              onClick={() => copy(webhook.verifyToken, "vt")}
            >
              <Copy className="h-4 w-4" />
            </Button>
            {copied === "vt" && (
              <span className="text-xs text-primary">Copiado ✓</span>
            )}
          </div>
        </div>
        {webhook.signatureLayer ? (
          <p className="flex items-center gap-2 text-xs text-success">
            <ShieldCheck className="h-4 w-4" /> Verificación de firma activa
            (META_APP_SECRET configurado): cada evento se valida con
            x-hub-signature-256.
          </p>
        ) : (
          <p className="flex items-start gap-2 text-xs text-destructive">
            <Info className="mt-0.5 h-4 w-4 shrink-0" /> Falta META_APP_SECRET:
            esta instancia RECHAZA los eventos que no puede verificar, así que
            no llegará ningún mensaje hasta configurarlo.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

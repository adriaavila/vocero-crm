"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Copy,
  Info,
  Sparkles,
  ShieldCheck,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

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
  saasMode: boolean,
  connection: Connection | null,
): boolean {
  return saasMode && connection?.status !== "reconnect_required";
}

export function WhatsappWizard({ saasMode = false }: { saasMode?: boolean }) {
  const [connection, setConnection] = useState<Connection | null>(null);
  const [webhook, setWebhook] = useState<WebhookInfo | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [retryNotice, setRetryNotice] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    const [c, w] = await Promise.all([
      fetch("/api/settings/whatsapp").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/settings/webhook").then((r) => (r.ok ? r.json() : null)),
    ]).catch(() => [null, null]);
    if (c) setConnection(c.connection);
    if (w) setWebhook(w);
    setLoaded(true);
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

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

  return (
    <div className="max-w-3xl space-y-6">
      <header>
        <p className="kicker">Configuración · paso 3 de 7</p>
        <h1 className="mt-1 text-2xl font-[680] tracking-tight">Conecta tu WhatsApp</h1>
        <p className="mt-2 max-w-xl text-sm leading-6 text-text-2">Primero conectamos el canal. Después ajustarás horarios, información del negocio y probarás respuestas antes de activar.</p>
        <ol aria-label="Progreso de configuración" className="mt-6 grid max-w-xl grid-cols-7 gap-2">
          {["Cuenta", "Pago", "WhatsApp", "Horario", "Negocio", "Prueba", "Activar"].map((label, index) => {
            const current = index === 2;
            const complete = index < 2;
            return (
              <li key={label} className="min-w-0">
                <div className={`h-1.5 rounded-full ${current ? "bg-brand" : complete ? "bg-success" : "bg-secondary"}`} />
                <span className={`mt-2 block truncate text-[11px] font-semibold ${current ? "text-brand-text" : "text-text-3"}`}>
                  {label}
                </span>
              </li>
            );
          })}
        </ol>
      </header>
      {saasMode && (
        <Card className="overflow-hidden border-brand-soft bg-brand-tint">
          <CardHeader>
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand text-brand-fg"><Sparkles className="h-5 w-5" /></span>
              <div>
                <CardTitle>Conexión guiada con Meta</CardTitle>
                <CardDescription className="mt-1">Usa el flujo oficial de Meta. No copies tokens y conserva tu WhatsApp Business cuando sea compatible.</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <Button
              type="button"
              className="w-full sm:w-auto"
              disabled={connecting}
              onClick={async () => {
                setConnecting(true);
                setConnectError(null);
                const response = await fetch("/api/saas/whatsapp/onboarding-link", { method: "POST" }).catch(() => null);
                const payload = (await response?.json().catch(() => null)) as { url?: string; error?: { message?: string } } | null;
                if (response?.ok && payload?.url) {
                  window.location.assign(payload.url);
                  return;
                }
                setConnecting(false);
                setConnectError(payload?.error?.message ?? "La conexión guiada aún no está disponible.");
              }}
            >
              {connecting ? "Preparando conexión…" : "Conectar con Meta"}<ArrowRight className="ml-2 h-4 w-4" />
            </Button>
            {connectError && <p className="mt-3 text-sm text-destructive">{connectError}</p>}
            <p className="mt-3 text-xs text-text-3">Se abrirá una ventana segura y volverás aquí cuando el número esté conectado.</p>
            {shouldShowHandoverRecovery(saasMode, connection) && (
              <div className="mt-4 border-t border-brand-soft pt-4">
                {/* El alta puede caerse DESPUÉS de conectar el número en Meta: ahí
                    el número ya es suyo y reconectarlo es justo lo que no hay que
                    hacer. Este botón repite solo la entrega. */}
                <p className="text-xs text-text-3">
                  {connection
                    ? "¿Tu número aparece conectado, pero Vocero no recibe mensajes? Vuelve a sincronizar la conexión sin reconectarlo."
                    : "¿Ya conectaste tu número con Meta y no aparece aquí?"}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  disabled={retrying}
                  onClick={async () => {
                    setRetrying(true);
                    setRetryNotice(null);
                    const response = await fetch("/api/saas/whatsapp/retry-connection", { method: "POST" }).catch(() => null);
                    const payload = (await response?.json().catch(() => null)) as { error?: { message?: string } } | null;
                    setRetrying(false);
                    if (response?.ok) {
                      setRetryNotice(connection
                        ? "Listo: volvimos a sincronizar la conexión."
                        : "Listo: tu número quedó conectado.");
                      void refetch();
                      return;
                    }
                    setRetryNotice(payload?.error?.message ?? "No se pudo recuperar la conexión.");
                  }}
                >
                  {retrying ? "Recuperando…" : "Recuperar mi conexión"}
                </Button>
                {retryNotice && <p className="mt-2 text-sm text-text-2">{retryNotice}</p>}
              </div>
            )}
          </CardContent>
        </Card>
      )}
      {connection?.status === "reconnect_required" && (
        <div className="flex items-start gap-2 rounded-lg border border-danger-soft bg-danger-tint p-4 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <div>
            <p className="font-medium text-danger-text">
              El token de WhatsApp expiró o fue revocado.
            </p>
            <p className="text-danger-text opacity-80">
              Los envíos están pausados. Pega un token nuevo abajo y prueba la
              conexión para reconectar.
            </p>
          </div>
        </div>
      )}

      {connection && connection.status === "connected" && (
        <div className="flex items-center gap-3 rounded-lg border border-success-soft bg-success-tint p-4">
          <CheckCircle2 className="h-5 w-5 text-success" />
          <div className="flex-1 text-sm">
            <p className="font-medium text-success-text">
              Número conectado: {connection.displayPhoneNumber ?? connection.phoneNumberId}
            </p>
            <p className="text-success-text opacity-80">
              {connection.verifiedName ? `${connection.verifiedName} · ` : ""}
              token …{connection.tokenLast4}
            </p>
          </div>
          <Badge variant="success">Conectado</Badge>
        </div>
      )}

      <ConnectForm existing={connection} onSaved={() => void refetch()} saasMode={saasMode} />

      {webhook && <WebhookCard webhook={webhook} />}
    </div>
  );
}

function ConnectForm({
  existing,
  onSaved,
  saasMode,
}: {
  existing: Connection | null;
  onSaved: () => void;
  saasMode: boolean;
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
          {existing ? "Reconectar / actualizar el número" : saasMode ? "Conexión manual (respaldo)" : "Conectar tu número de WhatsApp"}
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

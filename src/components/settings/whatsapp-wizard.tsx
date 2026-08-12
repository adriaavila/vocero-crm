"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Info,
  Smartphone,
  ShieldCheck,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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

export function WhatsappWizard() {
  const [connection, setConnection] = useState<Connection | null>(null);
  const [webhook, setWebhook] = useState<WebhookInfo | null>(null);
  const [loaded, setLoaded] = useState(false);

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
    return <p className="text-sm text-muted-foreground">Cargando…</p>;
  }

  return (
    <div className="max-w-3xl space-y-6">
      {connection?.status === "reconnect_required" && (
        <div className="flex items-start gap-2 rounded-lg border border-[#ecd4d2] bg-[#faf1f0] p-4 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <div>
            <p className="font-medium text-[#a2504c]">
              El token de WhatsApp expiró o fue revocado.
            </p>
            <p className="text-[#a2504c]/80">
              Los envíos están pausados. Pega un token nuevo abajo y prueba la
              conexión para reconectar.
            </p>
          </div>
        </div>
      )}

      {connection && connection.status === "connected" && (
        <div className="flex items-center gap-3 rounded-lg border border-[#d8e8dd] bg-[#eff7f1] p-4">
          <CheckCircle2 className="h-5 w-5 text-success" />
          <div className="flex-1 text-sm">
            <p className="font-medium text-[#3f6b52]">
              Número conectado: {connection.displayPhoneNumber ?? connection.phoneNumberId}
            </p>
            <p className="text-[#3f6b52]/80">
              {connection.verifiedName ? `${connection.verifiedName} · ` : ""}
              token …{connection.tokenLast4}
            </p>
          </div>
          <Badge variant="success">Conectado</Badge>
        </div>
      )}

      <ConnectForm existing={connection} onSaved={() => void refetch()} />

      <LabPhoneSetup />

      {webhook && <WebhookCard webhook={webhook} />}
    </div>
  );
}

type LabPhone = {
  configured: boolean;
  status?: string;
  phone?: string | null;
  name?: string | null;
};

function LabPhoneSetup() {
  const [phone, setPhone] = useState<LabPhone | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    const res = await fetch("/api/lab/live", { cache: "no-store" }).catch(() => null);
    if (res?.ok) setPhone((await res.json()) as LabPhone);
  }, []);

  useEffect(() => {
    void refetch();
    const timer = window.setInterval(() => void refetch(), 5_000);
    return () => window.clearInterval(timer);
  }, [refetch]);

  async function start() {
    setStarting(true);
    setError(null);
    const res = await fetch("/api/lab/live", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "start" }),
    }).catch(() => null);
    setStarting(false);
    if (!res?.ok) {
      const data = (await res?.json().catch(() => null)) as { error?: { message?: string } } | null;
      setError(data?.error?.message ?? "No se pudo iniciar la vinculación");
      return;
    }
    await refetch();
  }

  if (phone && !phone.configured) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Smartphone className="h-4 w-4 text-primary" /> Teléfono de prueba del Laboratorio
        </CardTitle>
        <CardDescription>
          Vincula un WhatsApp personal para probar el agente de extremo a extremo. No reemplaza el número empresarial conectado arriba.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!phone ? (
          <p className="text-sm text-muted-foreground">Comprobando conexión…</p>
        ) : phone.status === "WORKING" ? (
          <div className="flex items-center gap-3 rounded-md border border-[#d8e8dd] bg-[#eff7f1] p-3">
            <CheckCircle2 className="h-4 w-4 text-success" />
            <div className="flex-1 text-sm">
              <p className="font-medium text-[#3f6b52]">{phone.name || "WhatsApp personal"}</p>
              {phone.phone && <p className="text-[#3f6b52]/80">+{phone.phone}</p>}
            </div>
            <Badge variant="success">Vinculado</Badge>
          </div>
        ) : (
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
            {phone.status?.startsWith("SCAN_QR") && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src="/api/lab/live?qr=1"
                alt="QR para vincular el teléfono de prueba"
                className="h-44 w-44 rounded-md border bg-white p-2"
              />
            )}
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                {phone.status?.startsWith("SCAN_QR")
                  ? "En el teléfono abre WhatsApp → Dispositivos vinculados y escanea este QR."
                  : "Inicia la conexión para generar el QR de emparejamiento."}
              </p>
              {!phone.status?.startsWith("SCAN_QR") && (
                <Button onClick={() => void start()} disabled={starting}>
                  {starting ? "Iniciando…" : "Vincular teléfono de prueba"}
                </Button>
              )}
            </div>
          </div>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}

function ConnectForm({
  existing,
  onSaved,
}: {
  existing: Connection | null;
  onSaved: () => void;
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
          {existing ? "Reconectar / actualizar el número" : "Conectar tu número de WhatsApp"}
        </CardTitle>
        <CardDescription>
          Añade los datos de conexión. Los validamos antes de guardarlos y el acceso se almacena cifrado.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <details className="rounded-md border bg-background/40 p-4 text-sm">
          <summary className="cursor-pointer font-medium">Información técnica</summary>
          <div className="mt-3">
          <p className="mb-3 font-medium">¿De dónde sale el token?</p>
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
        </details>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="waba-id">ID de cuenta empresarial</Label>
            <Input
              id="waba-id"
              placeholder="ID de la cuenta de WhatsApp Business"
              value={wabaId}
              onChange={(e) => setWabaId(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="phone-number-id">ID del número</Label>
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

        <div className="flex flex-wrap gap-2">
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
        <CardDescription>Datos para que WhatsApp entregue mensajes a Vocero.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <details>
          <summary className="cursor-pointer text-sm font-medium">Información técnica</summary>
          <div className="mt-3 space-y-3">
          <p className="text-xs text-muted-foreground">Usa estos valores en el panel de Meta o en el override por WABA de tu backend. Guarda primero la conexión.</p>
        {!webhook.isHttps && (
          <p className="flex items-start gap-2 rounded-md border border-[#ece2cf] bg-[#faf7f0] p-3 text-xs text-[#8a6d3b]">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            La URL configurada no es https: Meta exige https para los webhooks.
            Ajusta APP_BASE_URL con tu dominio público.
          </p>
        )}
        <div className="space-y-1.5">
          <Label>URL del webhook (callback URL)</Label>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-md border bg-background/60 px-3 py-2 text-xs">
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
            <code className="min-w-0 flex-1 truncate rounded-md border bg-background/60 px-3 py-2 text-xs">
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
          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-4 w-4 shrink-0" /> Sin App Secret
            configurado: el webhook queda protegido por la URL secreta (normal
            en modo agencia). Para la capa extra de firma, agrega
            META_APP_SECRET a la instancia.
          </p>
        )}
          </div>
        </details>
      </CardContent>
    </Card>
  );
}

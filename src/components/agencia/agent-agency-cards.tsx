"use client";

import { useEffect, useState, type ChangeEvent } from "react";
import { Switch } from "@/components/ui/switch";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/**
 * Capa de agencia — los controles del agente que este fork añade sobre el
 * Vocero de upstream, y que existen porque aquí una instancia se ENTREGA a un
 * cliente en lugar de configurarla su propio dueño.
 *
 * Viven en `components/agencia/` a propósito: upstream nunca va a crear esa
 * carpeta, así que fusionar su siguiente versión no las toca. La regla del
 * fork es que todo lo propio vive aquí y el archivo de upstream solo recibe
 * una línea que lo monta.
 *
 * - **Mensajes de activación**: mientras se prueba una cuenta nueva, el agente
 *   solo contesta a mensajes exactos. Un lead real que escriba otra cosa no
 *   recibe nada del bot.
 * - **Números permitidos**: durante el piloto, solo los teléfonos del equipo
 *   hablan con el agente.
 * - **Proveedor de IA**: OpenAI o el modelo gratuito de OpenRouter, por
 *   organización. El adaptador cae al otro si el preferido falla.
 */

export type AgencyProfile = {
  activationEnabled: boolean;
  activationMessages: string[];
  allowlistEnabled: boolean;
  allowedWaIds: string[];
  aiProvider: "openai" | "openrouter";
};

export type AiCredentialStatus = {
  provider: "openai" | "openrouter";
  configured: boolean;
  source: "organization" | "platform" | "none";
  model: string;
  last4: string | null;
  lastValidatedAt: string | null;
  /** Dispatch v2, step 6: Nea marca `invalid` cuando esta clave falla. */
  lastValidationStatus: "valid" | "invalid" | "auth_failed" | "no_credits" | null;
};

export type AgencyAiCredentials = {
  openai: AiCredentialStatus;
  openrouter: AiCredentialStatus;
};

type Save = (patch: Partial<AgencyProfile>) => Promise<boolean>;

export function AgencyAgentCards({
  profile,
  onSave,
  credentials,
  onCredentialsChanged,
}: {
  profile: AgencyProfile;
  onSave: Save;
  credentials: AgencyAiCredentials | null;
  onCredentialsChanged: () => void;
}) {
  return (
    <>
      <ActivationMessagesSection profile={profile} onSave={onSave} />
      <AllowedNumbersSection profile={profile} onSave={onSave} />
      <AiProviderSection profile={profile} onSave={onSave} />
      <AiCredentialsSection
        credentials={credentials}
        onChanged={onCredentialsChanged}
      />
    </>
  );
}

function AiCredentialsSection({
  credentials,
  onChanged,
}: {
  credentials: AgencyAiCredentials | null;
  onChanged: () => void;
}) {
  const [provider, setProvider] = useState<AiCredentialStatus["provider"]>("openrouter");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("z-ai/glm-5.3-flash");
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const status = credentials?.[provider] ?? null;

  useEffect(() => {
    setModel(status?.model ?? (provider === "openrouter" ? "z-ai/glm-5.3-flash" : "gpt-4o-mini"));
    setApiKey("");
    setError(null);
  }, [provider, status?.model]);

  async function save() {
    if (!apiKey.trim() || !model.trim()) return;
    setSaving(true);
    setError(null);
    const response = await fetch("/api/agent/credentials", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider, apiKey, model }),
    }).catch(() => null);
    const payload = (await response?.json().catch(() => null)) as {
      error?: { message?: string };
    } | null;
    if (!response?.ok) {
      setError(payload?.error?.message ?? "No se pudo validar la credencial.");
      setSaving(false);
      return;
    }
    setApiKey("");
    setSaving(false);
    onChanged();
  }

  async function remove() {
    setRemoving(true);
    setError(null);
    const response = await fetch(`/api/agent/credentials?provider=${provider}`, {
      method: "DELETE",
    }).catch(() => null);
    if (!response?.ok) {
      const payload = (await response?.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setError(payload?.error?.message ?? "No se pudo eliminar la credencial.");
      setRemoving(false);
      return;
    }
    setRemoving(false);
    onChanged();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tu token de OpenRouter (opcional)</CardTitle>
        <CardDescription>
          Si pones tu token, el consumo de IA corre por tu cuenta. Si no,
          respondemos con el de allok.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="agent-credential-provider">Proveedor</Label>
          <select
            id="agent-credential-provider"
            value={provider}
            onChange={(event) => setProvider(event.target.value as AiCredentialStatus["provider"])}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <option value="openrouter">OpenRouter</option>
            <option value="openai">OpenAI</option>
          </select>
        </div>
        <div className="rounded-md border bg-subtle px-3 py-2 text-xs text-muted-foreground">
          {status?.source === "organization"
            ? `Token guardado: ••••${status.last4 ?? ""}`
            : status?.source === "platform"
              ? "Usando la clave de plataforma"
              : "Sin clave configurada"}
        </div>
        {status?.source === "organization" &&
          status.lastValidationStatus &&
          status.lastValidationStatus !== "valid" && (
            // Dispatch v2, step 6/item 11: Nea reportó por qué esta clave
            // dejó de servir y siguió respondiendo con la de allok — copia
            // distinta según la razón, en vez de un genérico "rechazado" que
            // no le dice al dueño si tiene que cambiar la clave o recargar.
            <p role="alert" className="rounded-md border border-danger-soft bg-danger-tint px-3 py-2 text-sm text-danger-text">
              {status.lastValidationStatus === "no_credits"
                ? `Tu token de ${provider === "openrouter" ? "OpenRouter" : "OpenAI"} se quedó sin créditos. Respondemos con el de allok mientras recargas.`
                : `Tu token de ${provider === "openrouter" ? "OpenRouter" : "OpenAI"} fue rechazado. Respondemos con el de allok mientras lo cambias.`}
            </p>
          )}
        <div className="space-y-1.5">
          <Label htmlFor="agent-api-key">Token</Label>
          <Input
            id="agent-api-key"
            type="password"
            autoComplete="new-password"
            placeholder={status?.source === "organization" ? "Pega una nueva clave para reemplazarla" : "Pega tu API key"}
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="agent-ai-model">Modelo</Label>
          <Input
            id="agent-ai-model"
            value={model}
            onChange={(event) => setModel(event.target.value)}
            placeholder={provider === "openrouter" ? "z-ai/glm-5.3-flash" : "gpt-4o-mini"}
          />
        </div>
        {status?.lastValidatedAt && (
          <p className="text-xs text-muted-foreground">
            Última validación: {new Date(status.lastValidatedAt).toLocaleString("es-MX")}
          </p>
        )}
        {error && <p role="alert" className="rounded-md border border-danger-soft bg-danger-tint px-3 py-2 text-sm text-danger-text">{error}</p>}
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void save()} disabled={saving || !apiKey.trim() || !model.trim()}>
            {saving ? "Probando…" : "Probar y guardar"}
          </Button>
          {status?.source === "organization" && (
            <Button variant="ghost" onClick={() => void remove()} disabled={removing}>
              {removing ? "Eliminando…" : "Usar clave de plataforma"}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function AiProviderSection({
  profile,
  onSave,
}: {
  profile: AgencyProfile;
  onSave: Save;
}) {
  const [provider, setProvider] = useState(profile.aiProvider);
  useEffect(() => setProvider(profile.aiProvider), [profile]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Proveedor de IA</CardTitle>
        <CardDescription>
          Cuál se intenta primero. Si falla o no está configurado, el agente cae
          automáticamente al otro: el turno nunca se queda sin respuesta por
          esto.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="agent-provider">Preferido</Label>
          <select
            id="agent-provider"
            value={provider}
            onChange={(e) => setProvider(e.target.value as AgencyProfile["aiProvider"])}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <option value="openrouter">OpenRouter (recomendado)</option>
            <option value="openai">OpenAI</option>
          </select>
        </div>
        <Button
          size="sm"
          disabled={provider === profile.aiProvider}
          onClick={() => void onSave({ aiProvider: provider })}
        >
          Guardar proveedor
        </Button>
      </CardContent>
    </Card>
  );
}

function AllowedNumbersSection({
  profile,
  onSave,
}: {
  profile: AgencyProfile;
  onSave: Save;
}) {
  const [enabled, setEnabled] = useState(profile.allowlistEnabled);
  const [numbers, setNumbers] = useState(profile.allowedWaIds.join("\n"));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setEnabled(profile.allowlistEnabled);
    setNumbers(profile.allowedWaIds.join("\n"));
  }, [profile]);

  const allowedWaIds = numbers
    .split(/[\s,;]+/)
    .map((number) => number.trim())
    .filter(Boolean);

  async function save() {
    setSaving(true);
    await onSave({ allowlistEnabled: enabled, allowedWaIds });
    setSaving(false);
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle>Números autorizados</CardTitle>
            <CardDescription>
              Limita las respuestas de la IA a números de prueba específicos.
              Desactívalo para responder a cualquier cliente.
            </CardDescription>
          </div>
          <Switch checked={enabled} label="Limitar a números autorizados" onCheckedChange={setEnabled} />
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <Textarea
          aria-label="Números autorizados"
          rows={4}
          placeholder={"12057071653\n5215512345678"}
          value={numbers}
          onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setNumbers(event.target.value)}
          disabled={!enabled}
        />
        <p className="text-xs text-muted-foreground">
          Uno por línea, en formato internacional y sin espacios.
        </p>
        <Button
          onClick={() => void save()}
          disabled={saving || (enabled && allowedWaIds.length === 0)}
        >
          {saving ? "Guardando…" : "Guardar números"}
        </Button>
      </CardContent>
    </Card>
  );
}

function ActivationMessagesSection({
  profile,
  onSave,
}: {
  profile: AgencyProfile;
  onSave: Save;
}) {
  const [enabled, setEnabled] = useState(profile.activationEnabled);
  const [messages, setMessages] = useState(profile.activationMessages);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setEnabled(profile.activationEnabled);
    setMessages(profile.activationMessages);
  }, [profile]);

  const validMessages = messages.map((message) => message.trim()).filter(Boolean);

  async function save() {
    setSaving(true);
    await onSave({ activationEnabled: enabled, activationMessages: validMessages });
    setSaving(false);
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle>Activación automática</CardTitle>
            <CardDescription>
              Si un chat está pausado, uno de estos mensajes activa la IA y comienza
              una conversación normal.
            </CardDescription>
          </div>
          <Switch checked={enabled} label="Activar IA mediante mensajes" onCheckedChange={setEnabled} />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {messages.map((message, index) => (
          <div key={index} className="flex items-center gap-2">
            <Input
              aria-label={`Mensaje activador ${index + 1}`}
              placeholder="p. ej. Quiero agendar una cita"
              value={message}
              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                setMessages(messages.map((item, i) => (i === index ? event.target.value : item)))
              }
            />
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Eliminar mensaje ${index + 1}`}
              onClick={() => setMessages(messages.filter((_, i) => i !== index))}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            onClick={() => setMessages([...messages, ""])}
            disabled={messages.length >= 50}
          >
            <Plus className="h-4 w-4" /> Agregar mensaje
          </Button>
          <Button
            onClick={() => void save()}
            disabled={saving || (enabled && validMessages.length === 0)}
          >
            {saving ? "Guardando…" : "Guardar activadores"}
          </Button>
        </div>
        {enabled && validMessages.length === 0 && (
          <p className="text-xs text-muted-foreground">
            Agrega al menos un mensaje antes de activar este modo.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

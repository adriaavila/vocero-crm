"use client";

import { useEffect, useState, type ChangeEvent } from "react";
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

type Save = (patch: Partial<AgencyProfile>) => Promise<boolean>;

export function AgencyAgentCards({
  profile,
  onSave,
}: {
  profile: AgencyProfile;
  onSave: Save;
}) {
  return (
    <>
      <ActivationMessagesSection profile={profile} onSave={onSave} />
      <AllowedNumbersSection profile={profile} onSave={onSave} />
      <AiProviderSection profile={profile} onSave={onSave} />
    </>
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
          automáticamente al otro — el turno nunca se queda sin respuesta por
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
            <option value="openai">OpenAI (recomendado)</option>
            <option value="openrouter">OpenRouter — modelo gratuito</option>
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
          <button
            role="switch"
            aria-checked={enabled}
            aria-label="Limitar a números autorizados"
            onClick={() => setEnabled(!enabled)}
            className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
              enabled ? "bg-primary" : "bg-secondary"
            }`}
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
                enabled ? "translate-x-5" : "translate-x-0.5"
              }`}
            />
          </button>
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
          <button
            role="switch"
            aria-checked={enabled}
            aria-label="Activar IA mediante mensajes"
            onClick={() => setEnabled(!enabled)}
            className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
              enabled ? "bg-primary" : "bg-secondary"
            }`}
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
                enabled ? "translate-x-5" : "translate-x-0.5"
              }`}
            />
          </button>
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


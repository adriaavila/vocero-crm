"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Sparkles, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type Profile = {
  enabled: boolean;
  name: string;
  tone: string | null;
  instructions: string | null;
  escalationRules: string | null;
  greeting: string | null;
  activationEnabled: boolean;
  activationMessages: string[];
  allowlistEnabled: boolean;
  allowedWaIds: string[];
};

type KbEntry = {
  id: string;
  kind: "qa" | "block";
  question: string | null;
  answer: string | null;
  content: string | null;
};

export function AgentClient() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [aiConfigured, setAiConfigured] = useState(true);
  const [entries, setEntries] = useState<KbEntry[]>([]);
  const [kbSize, setKbSize] = useState<{ chars: number; warnAt: number; warning: boolean } | null>(null);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    const [p, kb, size] = await Promise.all([
      fetch("/api/agent/profile").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/kb").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/kb/size").then((r) => (r.ok ? r.json() : null)),
    ]).catch(() => [null, null, null]);
    if (p) {
      setProfile(p.profile);
      setAiConfigured(p.aiConfigured);
    }
    if (kb) setEntries(kb.entries);
    if (size) setKbSize(size);
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  if (!profile) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Cargando…
      </div>
    );
  }

  async function saveProfile(patch: Partial<Profile>): Promise<boolean> {
    setSaveError(null);
    const response = await fetch("/api/agent/profile", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    }).catch(() => null);
    if (!response?.ok) {
      setSaveError("No se pudo guardar. Revisa los campos e inténtalo otra vez.");
      return false;
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    await refetch();
    return true;
  }

  return (
    <div className="h-full overflow-y-auto">
      <header className="flex items-center justify-between border-b px-6 py-4">
        <h2 className="font-semibold">Agente de IA</h2>
        <div className="flex items-center gap-3">
          {saved && <span className="text-xs text-primary">Guardado ✓</span>}
          {saveError && <span className="text-xs text-destructive">{saveError}</span>}
          <span className="text-sm text-muted-foreground">
            {profile.enabled ? "Encendido" : "Apagado"}
          </span>
          <button
            role="switch"
            aria-checked={profile.enabled}
            aria-label="Agente encendido"
            disabled={!aiConfigured}
            onClick={() => void saveProfile({ enabled: !profile.enabled })}
            className={`relative h-6 w-11 rounded-full transition-colors disabled:opacity-40 ${
              profile.enabled ? "bg-primary" : "bg-secondary"
            }`}
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
                profile.enabled ? "translate-x-5" : "translate-x-0.5"
              }`}
            />
          </button>
        </div>
      </header>

      {!aiConfigured && (
        <div className="mx-6 mt-6 rounded-lg border border-brand-soft bg-brand-tint p-6 text-center">
          <Sparkles className="mx-auto mb-2 h-8 w-8 text-primary" />
          <p className="font-medium">Configura tu proveedor de IA para activar el agente</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            Agrega <code className="rounded bg-secondary px-1">OPENROUTER_API_TOKEN</code> y{" "}
            <code className="rounded bg-secondary px-1">OPENROUTER_MODEL</code> a las variables
            de entorno de la instancia y reiníciala. Mientras tanto puedes dejar listo el
            comportamiento y el conocimiento aquí abajo.
          </p>
        </div>
      )}

      <div className="grid gap-6 p-6 lg:grid-cols-2">
        <div className="space-y-6">
          <ProfileSection profile={profile} onSave={saveProfile} />
          <ActivationMessagesSection profile={profile} onSave={saveProfile} />
          <AllowedNumbersSection profile={profile} onSave={saveProfile} />
        </div>
        <KbSection entries={entries} kbSize={kbSize} onChanged={() => void refetch()} />
      </div>
    </div>
  );
}

function AllowedNumbersSection({
  profile,
  onSave,
}: {
  profile: Profile;
  onSave: (patch: Partial<Profile>) => Promise<boolean>;
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
          onChange={(event) => setNumbers(event.target.value)}
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
  profile: Profile;
  onSave: (patch: Partial<Profile>) => Promise<boolean>;
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
              onChange={(event) =>
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

function ProfileSection({
  profile,
  onSave,
}: {
  profile: Profile;
  onSave: (patch: Partial<Profile>) => Promise<boolean>;
}) {
  const [form, setForm] = useState(profile);
  const [freeText, setFreeText] = useState("");
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  useEffect(() => setForm(profile), [profile]);

  async function parseFreeText() {
    setParsing(true);
    setParseError(null);
    const response = await fetch("/api/agent/profile/parse", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: freeText }),
    }).catch(() => null);
    const data = response ? await response.json().catch(() => null) : null;
    if (!response?.ok || !data?.draft) {
      setParseError(data?.error?.message ?? "No se pudo procesar el texto.");
    } else {
      const draft = Object.fromEntries(
        Object.entries(data.draft).filter(([, value]) => value !== null)
      ) as Partial<Profile>;
      setForm((current) => ({ ...current, ...draft }));
    }
    setParsing(false);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Comportamiento</CardTitle>
        <CardDescription>
          Cómo se presenta y actúa el agente al responder a tus clientes.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2 rounded-md border border-brand-soft bg-brand-tint p-3">
          <Label htmlFor="agent-free-text">Completar desde texto libre</Label>
          <Textarea
            id="agent-free-text"
            rows={5}
            placeholder="Pega aquí información del negocio, tono, políticas, horarios y cuándo debe intervenir una persona…"
            value={freeText}
            onChange={(e) => setFreeText(e.target.value)}
          />
          <Button
            type="button"
            variant="secondary"
            onClick={() => void parseFreeText()}
            disabled={parsing || freeText.trim().length < 20}
          >
            <Sparkles className="h-4 w-4" />
            {parsing ? "Procesando…" : "Completar con IA gratis"}
          </Button>
          {parseError && <p className="text-xs text-destructive">{parseError}</p>}
          <p className="text-xs text-muted-foreground">
            Completa el borrador; revísalo antes de guardar.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="agent-name">Nombre del agente</Label>
          <Input
            id="agent-name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="agent-tone">Tono</Label>
          <Input
            id="agent-tone"
            placeholder="p. ej. cercano y directo, con usted"
            value={form.tone ?? ""}
            onChange={(e) => setForm({ ...form, tone: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="agent-instructions">Instrucciones</Label>
          <Textarea
            id="agent-instructions"
            rows={5}
            placeholder="Qué debe y no debe hacer el agente…"
            value={form.instructions ?? ""}
            onChange={(e) => setForm({ ...form, instructions: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="agent-escalation">Reglas de escalado</Label>
          <Textarea
            id="agent-escalation"
            rows={3}
            placeholder="Cuándo pasar la conversación a un humano…"
            value={form.escalationRules ?? ""}
            onChange={(e) => setForm({ ...form, escalationRules: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="agent-greeting">Saludo</Label>
          <Input
            id="agent-greeting"
            placeholder="Saludo para conversaciones nuevas"
            value={form.greeting ?? ""}
            onChange={(e) => setForm({ ...form, greeting: e.target.value })}
          />
        </div>
        <Button onClick={() => void onSave(form)}>Guardar comportamiento</Button>
      </CardContent>
    </Card>
  );
}

function KbSection({
  entries,
  kbSize,
  onChanged,
}: {
  entries: KbEntry[];
  kbSize: { chars: number; warnAt: number; warning: boolean } | null;
  onChanged: () => void;
}) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [block, setBlock] = useState("");

  async function addQa() {
    if (!question.trim() || !answer.trim()) return;
    await fetch("/api/kb", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "qa", question, answer }),
    }).catch(() => null);
    setQuestion("");
    setAnswer("");
    onChanged();
  }

  async function addBlock() {
    if (!block.trim()) return;
    await fetch("/api/kb", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "block", content: block }),
    }).catch(() => null);
    setBlock("");
    onChanged();
  }

  async function remove(id: string) {
    await fetch(`/api/kb/${id}`, { method: "DELETE" }).catch(() => null);
    onChanged();
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Knowledge base</CardTitle>
            <CardDescription>
              La única fuente de verdad del agente: lo que no está aquí, no lo
              afirma.
            </CardDescription>
          </div>
          {kbSize && (
            <Badge variant={kbSize.warning ? "warning" : "secondary"}>
              {kbSize.chars.toLocaleString("es-MX")} caracteres
            </Badge>
          )}
        </div>
        {kbSize?.warning && (
          <p className="text-xs text-[#8a6d3b]">
            El conocimiento se acerca al límite del contexto del modelo (v1 lo
            inyecta completo en cada turno). Considera depurar entradas.
          </p>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2 rounded-md border p-3">
          <p className="text-sm font-medium">Nueva pregunta / respuesta</p>
          <Input
            placeholder="Pregunta (p. ej. ¿Hacen envíos?)"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
          />
          <Textarea
            placeholder="Respuesta"
            rows={2}
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
          />
          <Button
            size="sm"
            onClick={() => void addQa()}
            disabled={!question.trim() || !answer.trim()}
          >
            <Plus className="h-4 w-4" /> Agregar P/R
          </Button>
        </div>

        <div className="space-y-2 rounded-md border p-3">
          <p className="text-sm font-medium">Nuevo bloque de texto libre</p>
          <Textarea
            placeholder="Horarios, direcciones, políticas…"
            rows={3}
            value={block}
            onChange={(e) => setBlock(e.target.value)}
          />
          <Button size="sm" onClick={() => void addBlock()} disabled={!block.trim()}>
            <Plus className="h-4 w-4" /> Agregar bloque
          </Button>
        </div>

        <ul className="space-y-2">
          {entries.map((e) => (
            <li key={e.id} className="flex items-start gap-2 rounded-md border p-3">
              <div className="min-w-0 flex-1 text-sm">
                {e.kind === "qa" ? (
                  <>
                    <p className="font-medium">{e.question}</p>
                    <p className="mt-0.5 text-muted-foreground">{e.answer}</p>
                  </>
                ) : (
                  <p className="whitespace-pre-wrap text-muted-foreground">{e.content}</p>
                )}
              </div>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Eliminar entrada"
                onClick={() => void remove(e.id)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </li>
          ))}
          {entries.length === 0 && (
            <p className="py-2 text-center text-xs text-muted-foreground">
              Sin entradas todavía: agrega lo que el agente debe saber.
            </p>
          )}
        </ul>
      </CardContent>
    </Card>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { Switch } from "@/components/ui/switch";
import { Clock3, Plus, Sparkles, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
// Capa de agencia (fork). Todo lo propio vive en components/agencia/ para que
// la próxima fusión con upstream no toque este archivo más que en esta línea.
import {
  AgencyAgentCards,
  type AgencyAiCredentials,
  type AgencyProfile,
} from "@/components/agencia/agent-agency-cards";
import { useActivationGate } from "@/components/agencia/activation-gate";
import { AgentWeek } from "@/components/agencia/allok/agent-week";

type Profile = {
  enabled: boolean;
  name: string;
  tone: string | null;
  instructions: string | null;
  escalationRules: string | null;
  greeting: string | null;
} & AgencyProfile;

type KbEntry = {
  id: string;
  kind: "qa" | "block";
  question: string | null;
  answer: string | null;
  content: string | null;
};

export function AgentClient({ saasMode = false }: { saasMode?: boolean }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [aiConfigured, setAiConfigured] = useState(true);
  const [aiCredentials, setAiCredentials] = useState<AgencyAiCredentials | null>(null);
  const [entries, setEntries] = useState<KbEntry[]>([]);
  const [kbSize, setKbSize] = useState<{ chars: number; warnAt: number; warning: boolean } | null>(null);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const { toggle, gate } = useActivationGate({
    enabled: profile?.enabled ?? false,
    strict: saasMode,
    onConfirm: (enabled) => void saveProfile({ enabled }),
  });

  const refetch = useCallback(async () => {
    const [p, kb, size, credentials] = await Promise.all([
      fetch("/api/agent/profile").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/kb").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/kb/size").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/agent/credentials").then((r) => (r.ok ? r.json() : null)),
    ]).catch(() => [null, null, null, null] as const);
    if (p) {
      setProfile(p.profile);
      setAiConfigured(p.aiConfigured);
    }
    if (kb) setEntries(kb.entries);
    if (size) setKbSize(size);
    if (credentials?.credentials) setAiCredentials(credentials.credentials);
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  if (!profile) {
    return (
      <div className="h-full overflow-y-auto">
        <header className="flex items-center justify-between gap-2 border-b px-4 py-3 sm:px-6 sm:py-4">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-6 w-11 rounded-full" />
        </header>
        <div className="grid gap-4 p-4 sm:gap-6 sm:p-6 lg:grid-cols-2">
          <div className="space-y-4 sm:space-y-6">
            <Card>
              <CardHeader>
                <Skeleton className="h-5 w-32" />
              </CardHeader>
              <CardContent className="space-y-3">
                <Skeleton className="h-9 w-full" />
                <Skeleton className="h-20 w-full" />
              </CardContent>
            </Card>
          </div>
          <Card>
            <CardHeader>
              <Skeleton className="h-5 w-40" />
            </CardHeader>
            <CardContent className="space-y-3">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </CardContent>
          </Card>
        </div>
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
      const payload = (await response?.json().catch(() => null)) as { error?: { message?: string } } | null;
      setSaveError(payload?.error?.message ?? "No se pudo guardar el comportamiento del agente.");
      return false;
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    await refetch();
    return true;
  }

  return (
    <div className="h-full overflow-y-auto">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3 sm:px-6 sm:py-4">
        <h2 className="text-[17px] font-bold tracking-tight">Agente de IA</h2>
        <div className="flex items-center gap-3">
          {saved && <span className="text-xs text-primary">Guardado ✓</span>}
          <span className="text-sm text-muted-foreground">
            {profile.enabled ? "Encendido" : "Apagado"}
          </span>
          <Switch
            checked={profile.enabled}
            label="Agente encendido"
            disabled={!aiConfigured}
            onCheckedChange={() => void toggle()}
          />
        </div>
      </header>

      {saveError && (
        <p role="alert" className="mx-4 mt-4 rounded-lg border border-danger-soft bg-danger-tint px-3 py-2 text-sm text-danger-text sm:mx-6 sm:mt-6">
          {saveError}
        </p>
      )}

      {!aiConfigured && (
        <div className="mx-4 mt-4 rounded-lg border border-brand-soft bg-brand-tint p-5 text-center sm:mx-6 sm:mt-6 sm:p-6">
          <Sparkles className="mx-auto mb-2 h-8 w-8 text-primary" />
          <p className="font-medium">Configura tu proveedor de IA para que Rei pueda responder</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            Pega una clave de OpenRouter u OpenAI en la tarjeta <strong>Claves de IA</strong>.
            Si tu plataforma ya tiene una clave configurada, aparecerá automáticamente como
            disponible.
          </p>
        </div>
      )}

      <div className="grid gap-4 p-4 sm:gap-6 sm:p-6 lg:grid-cols-2">
        <div className="space-y-4 sm:space-y-6">
          <ProfileSection profile={profile} onSave={saveProfile} />
          <AgencyAgentCards
            profile={profile}
            onSave={saveProfile}
            credentials={aiCredentials}
            onCredentialsChanged={() => void refetch()}
          />
          {saasMode && <BusinessHoursSection />}
        </div>
        <KbSection entries={entries} kbSize={kbSize} onChanged={() => void refetch()} />
      </div>
      {gate}
    </div>
  );
}

type BusinessDay = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
type BusinessInterval = { start: string; end: string };
type BusinessHoursSettings = {
  weeklyHours: Partial<Record<BusinessDay, BusinessInterval[]>>;
  timezone: string;
  responseMode: "outside_hours" | "all_day";
};

const BUSINESS_DAYS: { key: BusinessDay; label: string; short: string }[] = [
  { key: "mon", label: "Lunes", short: "L" },
  { key: "tue", label: "Martes", short: "M" },
  { key: "wed", label: "Miércoles", short: "X" },
  { key: "thu", label: "Jueves", short: "J" },
  { key: "fri", label: "Viernes", short: "V" },
  { key: "sat", label: "Sábado", short: "S" },
  { key: "sun", label: "Domingo", short: "D" },
];

function BusinessHoursSection() {
  const [settings, setSettings] = useState<BusinessHoursSettings | null>(null);
  const [canUseAllDay, setCanUseAllDay] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetch("/api/settings/business-hours")
      .then(async (response) => {
        const payload = (await response.json().catch(() => null)) as {
          settings?: BusinessHoursSettings;
          canUseAllDay?: boolean;
        } | null;
        if (!response.ok || !payload?.settings) throw new Error("No se pudo cargar el horario.");
        setSettings(payload.settings);
        setCanUseAllDay(payload.canUseAllDay === true);
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "No se pudo cargar el horario."));
  }, []);

  if (!settings) {
    return <Card><CardHeader><Skeleton className="h-5 w-44" /><Skeleton className="h-4 w-full max-w-md" /></CardHeader><CardContent><Skeleton className="h-32 w-full" /></CardContent></Card>;
  }
  const currentSettings = settings;

  function toggleDay(day: BusinessDay) {
    const next = { ...currentSettings.weeklyHours };
    if (next[day]?.length) delete next[day];
    else next[day] = [{ start: "09:00", end: "18:00" }];
    setSettings({ ...currentSettings, weeklyHours: next });
    setSaved(false);
  }

  function setDayTime(day: BusinessDay, field: keyof BusinessInterval, value: string) {
    setSettings({
      ...currentSettings,
      weeklyHours: {
        ...currentSettings.weeklyHours,
        [day]: [{ ...(currentSettings.weeklyHours[day]?.[0] ?? { start: "09:00", end: "18:00" }), [field]: value }],
      },
    });
    setSaved(false);
  }

  function setDayAllDay(day: BusinessDay, allDay: boolean) {
    setSettings({
      ...currentSettings,
      weeklyHours: {
        ...currentSettings.weeklyHours,
        [day]: [allDay ? { start: "00:00", end: "00:00" } : { start: "09:00", end: "18:00" }],
      },
    });
    setSaved(false);
  }

  async function save() {
    setSaving(true);
    setSaved(false);
    setError(null);
    const response = await fetch("/api/settings/business-hours", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(currentSettings),
    }).catch(() => null);
    const payload = (await response?.json().catch(() => null)) as { settings?: BusinessHoursSettings; error?: { message?: string } } | null;
    if (!response?.ok || !payload?.settings) {
      setError(payload?.error?.message ?? "No se pudo guardar el horario.");
      setSaving(false);
      return;
    }
    setSettings(payload.settings);
    setSaved(true);
    setSaving(false);
  }

  return (
    <Card className="border-brand-soft">
      <CardHeader>
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-tint text-brand-text"><Clock3 className="h-4 w-4" /></span>
          <div><CardTitle>Horario de respuesta</CardTitle><CardDescription className="mt-1">Allok solo hablará por ti cuando esta regla lo permita. Es independiente del horario de citas.</CardDescription></div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2 sm:grid-cols-2" role="group" aria-label="Modo de atención">
          <button type="button" onClick={() => setSettings({ ...settings, responseMode: "outside_hours" })} className={`rounded-md border p-3 text-left transition-colors ${settings.responseMode === "outside_hours" ? "border-brand bg-brand-tint" : "hover:bg-subtle"}`}>
            <span className="block text-sm font-semibold">Fuera de horario</span>
            <span className="mt-1 block text-xs leading-5 text-text-3">Ideal para Esencial: Allok cubre las horas en que tu equipo descansa.</span>
          </button>
          <button type="button" disabled={!canUseAllDay} onClick={() => setSettings({ ...settings, responseMode: "all_day" })} className={`rounded-md border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-55 ${settings.responseMode === "all_day" ? "border-brand bg-brand-tint" : "hover:bg-subtle"}`}>
            <span className="flex items-center gap-2 text-sm font-semibold">Todo el día <Badge variant="success">Completo</Badge></span>
            <span className="mt-1 block text-xs leading-5 text-text-3">Responde durante toda la jornada, con supervisión humana siempre disponible.</span>
          </button>
        </div>

        <AgentWeek hours={currentSettings.weeklyHours} mode={settings.responseMode} timezone={settings.timezone} pro={canUseAllDay} />

        {settings.responseMode === "outside_hours" && <div className="space-y-2 rounded-md border p-3">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-text-3">Horario del negocio</p>
          {BUSINESS_DAYS.map((day) => {
            const interval = currentSettings.weeklyHours[day.key]?.[0];
            const open = Boolean(interval);
            const allDay = interval?.start === "00:00" && interval?.end === "00:00";
            return <div key={day.key} className="flex flex-wrap items-center gap-2 py-1">
              <button type="button" onClick={() => toggleDay(day.key)} aria-pressed={open} className={`flex h-9 w-24 items-center gap-2 rounded-md px-2 text-left text-sm font-medium ${open ? "bg-brand-tint text-brand-text" : "text-text-3 hover:bg-subtle"}`}><span className="grid h-5 w-5 place-items-center rounded-full border text-[10px]">{day.short}</span>{day.label}</button>
              {open ? allDay ? <><span className="rounded-md bg-brand-tint px-3 py-2 text-sm font-semibold text-brand-text">24 horas</span><button type="button" onClick={() => setDayAllDay(day.key, false)} className="text-xs font-semibold text-text-3 hover:text-foreground">Definir horario</button></> : <><Input aria-label={`${day.label}: abre`} type="time" value={interval?.start ?? "09:00"} onChange={(event) => setDayTime(day.key, "start", event.target.value)} className="h-9 w-28" /><span className="text-xs text-text-3">a</span><Input aria-label={`${day.label}: cierra`} type="time" value={interval?.end ?? "18:00"} onChange={(event) => setDayTime(day.key, "end", event.target.value)} className="h-9 w-28" /><button type="button" onClick={() => setDayAllDay(day.key, true)} className="text-xs font-semibold text-brand-text hover:underline">24 h</button></> : <span className="text-sm text-text-3">Cerrado</span>}
            </div>;
          })}
          <p className="mt-2 text-xs leading-5 text-text-3">Un cierre a las 00:00 termina al comenzar el día siguiente. Usa <strong className="font-semibold text-text-2">24 h</strong> para mantener ese día siempre abierto.</p>
        </div>}

        <div className="space-y-1.5"><Label htmlFor="business-timezone">Zona horaria IANA</Label><Input id="business-timezone" value={settings.timezone} onChange={(event) => setSettings({ ...settings, timezone: event.target.value })} placeholder="America/Mexico_City" /><p className="text-xs text-text-3">Usa la zona del negocio, no la del servidor.</p></div>
        {error && <p role="alert" className="rounded-md border border-danger-soft bg-danger-tint px-3 py-2 text-sm text-danger-text">{error}</p>}
        <div className="flex items-center gap-3"><Button onClick={() => void save()} disabled={saving}>{saving ? "Guardando…" : "Guardar horario"}</Button>{saved && <span className="text-xs text-success-text">Guardado ✓</span>}</div>
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
  useEffect(() => setForm(profile), [profile]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Comportamiento</CardTitle>
        <CardDescription>
          Cómo se presenta y actúa el agente al responder a tus clientes.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
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
          <p className="text-xs text-warning-text">
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

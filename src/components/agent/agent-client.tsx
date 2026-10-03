"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Switch } from "@/components/ui/switch";
import { ChevronRight, Clock3, Plus, Sparkles, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { TimezoneSelect } from "@/components/ui/timezone-select";
import { Skeleton } from "@/components/ui/skeleton";
// Capa de agencia (fork). Todo lo propio vive en components/agencia/ para que
// la próxima fusión con upstream no toque este archivo más que en esta línea.
import {
  AgencyAgentCards,
  type AgencyAiCredentials,
  type AgencyProfile,
} from "@/components/agencia/agent-agency-cards";
import { useSetup } from "@/components/agencia/activation-gate";
import { ActivarSection } from "@/components/agencia/activar";
import { AgentWeek } from "@/components/agencia/allok/agent-week";
import { SetupProgressNav } from "@/components/agencia/setup-progress";
import { TuNegocio } from "@/components/agencia/tu-negocio";
import { postKbEntry, saveResult, type SaveResult } from "@/lib/negocio";
import type { SetupProgress } from "@/server/agencia/setup-progress";

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

export function AgentClient({
  saasMode = false,
  externalBrainAlwaysOn = false,
  brandName = "Allok",
  brandNameLower = "allok",
  initialProgress = null,
}: {
  saasMode?: boolean;
  /**
   * Un cerebro externo LEGADO (BOT_API_KEY sin despacho) contesta pase lo
   * que pase con `profile.enabled` — el CRM no lo controla. Calculado en el
   * servidor con el mismo ingrediente que `agentOn` en `server/agencia/
   * estado.ts` (`cerebroExternoLegadoSiempreOn`).
   */
  externalBrainAlwaysOn?: boolean;
  /** "Allok" / "Rei", para el arranque de una oración. Resuelto en el servidor (`brand()` no es NEXT_PUBLIC_). */
  brandName?: string;
  /** "allok" / "Rei", mención dentro de una oración (allok es en minúscula). */
  brandNameLower?: string;
  /** El avance de la puesta en marcha, resuelto en el servidor. */
  initialProgress?: SetupProgress | null;
}) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [aiConfigured, setAiConfigured] = useState(true);
  const [aiCredentials, setAiCredentials] = useState<AgencyAiCredentials | null>(null);
  const [entries, setEntries] = useState<KbEntry[]>([]);
  const [kbSize, setKbSize] = useState<{ chars: number; warnAt: number; warning: boolean } | null>(null);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const { progress, gate, reload: reloadSetup, retry: retrySetup } = useSetup(initialProgress);

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
    // Lo que se guardó cambia qué falta para activar y qué paso toca.
    void reloadSetup();
  }, [reloadSetup]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  // Los enlaces de «qué falta» apuntan a #avanzado, #horario, #negocio o
  // #activar: con #avanzado hay que abrir el cajón para que el enlace lleve
  // a algo.
  useEffect(() => {
    const open = () => {
      if (window.location.hash === "#avanzado") setAdvancedOpen(true);
    };
    open();
    window.addEventListener("hashchange", open);
    return () => window.removeEventListener("hashchange", open);
  }, []);

  // Un enlace con ancla (/agent#activar) tiene que llegar a su sitio, y el
  // sitio se mueve mientras cargan el horario y la lectura de «Activar»: el
  // salto se hace UNA vez, cuando ya no queda nada por cargar encima.
  const ready = profile !== null;
  const [hoursLoaded, setHoursLoaded] = useState(false);
  const jumped = useRef(false);
  useEffect(() => {
    if (jumped.current || !ready || gate.kind === "loading" || (saasMode && !hoursLoaded)) return;
    jumped.current = true;
    if (window.location.hash) document.getElementById(window.location.hash.slice(1))?.scrollIntoView({ block: "start" });
  }, [ready, gate.kind, hoursLoaded, saasMode]);

  if (!profile) {
    return (
      <div className="h-full overflow-y-auto">
        <header className="flex items-center justify-between gap-2 border-b px-4 py-3 sm:px-6 sm:py-4">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-6 w-11 rounded-full" />
        </header>
        <div className="max-w-3xl space-y-4 p-4 sm:space-y-6 sm:p-6">
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
      </div>
    );
  }

  async function putProfile(patch: Partial<Profile>): Promise<SaveResult> {
    const result = await saveResult(() =>
      fetch("/api/agent/profile", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      }),
    );
    if (result.ok) await refetch();
    return result;
  }

  /** Guardado de las tarjetas de Avanzado: el error sale arriba de la página. */
  async function saveProfile(patch: Partial<Profile>): Promise<boolean> {
    setSaveError(null);
    const result = await putProfile(patch);
    if (!result.ok) {
      setSaveError(result.message === GENERIC_ERROR ? "No se pudo guardar el comportamiento del agente." : result.message);
      return false;
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    return true;
  }

  /** Encender pasa por «Activar»: el servidor revisa lo mismo que la tarjeta. */
  async function activate(): Promise<string | null> {
    const result = await putProfile({ enabled: true });
    if (!result.ok) {
      // Pudo haber cambiado lo que falta: se vuelve a leer.
      void reloadSetup();
      return result.message;
    }
    return null;
  }

  async function pause() {
    setSaveError(null);
    const result = await putProfile({ enabled: false });
    if (!result.ok) setSaveError(result.message);
  }

  /** El interruptor de arriba: apagar es inmediato; encender lleva a «Activar», que dice qué va a pasar. */
  function onSwitch() {
    if (!profile) return;
    if (profile.enabled) {
      void pause();
      return;
    }
    const target = document.getElementById("activar");
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target?.scrollIntoView({ behavior: calm ? "auto" : "smooth", block: "start" });
    target?.focus({ preventScroll: true });
  }

  const showProgress = progress?.active ?? false;

  return (
    <div className="h-full overflow-y-auto">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3 sm:px-6 sm:py-4">
        <h2 className="text-[17px] font-bold tracking-tight">Tu agente</h2>
        <div className="flex items-center gap-3">
          {saved && <span role="status" className="text-xs text-primary">Guardado ✓</span>}
          <span className="text-sm text-muted-foreground">
            {profile.enabled ? "Encendido" : "Apagado"}
          </span>
          <Switch
            checked={profile.enabled}
            label="Agente encendido"
            disabled={!aiConfigured}
            onCheckedChange={onSwitch}
          />
        </div>
      </header>

      <div className="max-w-3xl space-y-4 p-4 sm:space-y-6 sm:p-6">
        <p className="text-sm text-muted-foreground">
          {(() => {
            // Un cerebro externo legado contesta con el interruptor apagado
            // (no lo controla el CRM): sin esto, esta línea decía "Agente
            // apagado" mientras ese bot seguía respondiendo de verdad.
            const agentIsOn = profile.enabled || externalBrainAlwaysOn;
            if (!agentIsOn) return "Agente apagado. Nadie responde automáticamente.";
            const name = profile.name?.trim() || "Tu agente";
            // El horario de atención solo existe como concepto en SaaS
            // (canAgentRespondNow); una instancia dedicada contesta apenas
            // llega el mensaje, así que prometer un horario ahí sería falso.
            return saasMode
              ? `${name} está encendido y responde según tu horario de atención.`
              : `${name} está encendido y responde en tu WhatsApp.`;
          })()}
        </p>

        {progress && showProgress && <SetupProgressNav progress={progress} page="negocio" />}

        {saveError && (
          <p role="alert" className="rounded-lg border border-danger-soft bg-danger-tint px-3 py-2 text-sm text-danger-text">
            {saveError}
          </p>
        )}

        {!aiConfigured && (
          <div className="rounded-lg border border-brand-soft bg-brand-tint p-5 text-center sm:p-6">
            <Sparkles className="mx-auto mb-2 h-8 w-8 text-primary" />
            <p className="font-medium">La IA todavía no está lista en tu cuenta</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
              Escríbenos y lo resolvemos. Si tienes tu propia clave de OpenRouter u OpenAI, también puedes
              ponerla en <strong>Avanzado</strong>.
            </p>
          </div>
        )}

        <TuNegocio
          entries={entries}
          escalationRules={profile.escalationRules}
          progress={progress}
          saveHandoff={(rules) => putProfile({ escalationRules: rules })}
          onChanged={refetch}
        />

        {saasMode && (
          <div id="horario" className="scroll-mt-4">
            <BusinessHoursSection brandName={brandName} onSaved={() => void reloadSetup()} onLoaded={() => setHoursLoaded(true)} />
          </div>
        )}

        <ActivarSection
          enabled={profile.enabled}
          gate={gate}
          onRetry={retrySetup}
          onActivate={activate}
          onPause={pause}
        />

        <details
          id="avanzado"
          open={advancedOpen}
          onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}
          className="group scroll-mt-4 rounded-lg border border-border-strong bg-card"
        >
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-5 py-3 [&::-webkit-details-marker]:hidden">
            <span>
              <span className="block text-[16px] font-bold tracking-tight">Avanzado</span>
              <span className="block text-sm text-muted-foreground">
                Nombre, tono, saludo, instrucciones, clave de IA y números autorizados.
              </span>
            </span>
            <ChevronRight
              className="h-5 w-5 shrink-0 text-text-3 transition-transform group-open:rotate-90 motion-reduce:transition-none"
              aria-hidden="true"
            />
          </summary>
          <div className="space-y-4 border-t border-border p-4 sm:space-y-6 sm:p-5">
            <ProfileSection profile={profile} onSave={saveProfile} />
            <AgencyAgentCards
              profile={profile}
              onSave={saveProfile}
              credentials={aiCredentials}
              onCredentialsChanged={() => void refetch()}
              brandName={brandNameLower}
            />
            <KbSection entries={entries} kbSize={kbSize} onChanged={() => void refetch()} />
          </div>
        </details>
      </div>
    </div>
  );
}

const GENERIC_ERROR = "No se pudo guardar. Revisa el texto y vuelve a intentarlo.";

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

function BusinessHoursSection({ brandName, onSaved, onLoaded }: { brandName: string; onSaved?: () => void; onLoaded?: () => void }) {
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
      .catch((reason) => setError(reason instanceof Error ? reason.message : "No se pudo cargar el horario."))
      .finally(() => onLoaded?.());
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    onSaved?.();
  }

  return (
    <Card className="border-brand-soft">
      <CardHeader>
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-tint text-brand-text"><Clock3 className="h-4 w-4" /></span>
          <div><CardTitle>Horario de respuesta</CardTitle><CardDescription className="mt-1">{brandName} solo hablará por ti cuando esta regla lo permita. Es independiente del horario de citas.</CardDescription></div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2 sm:grid-cols-2" role="group" aria-label="Modo de atención">
          <button type="button" onClick={() => setSettings({ ...settings, responseMode: "outside_hours" })} className={`rounded-md border p-3 text-left transition-colors ${settings.responseMode === "outside_hours" ? "border-brand bg-brand-tint" : "hover:bg-subtle"}`}>
            <span className="block text-sm font-semibold">Fuera de horario</span>
            <span className="mt-1 block text-xs leading-5 text-text-3">Ideal para Esencial: {brandName} cubre las horas en que tu equipo descansa.</span>
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
              <button type="button" onClick={() => toggleDay(day.key)} aria-pressed={open} className={`flex h-11 w-28 items-center gap-2 rounded-md px-2 text-left text-sm font-medium sm:h-9 sm:w-24 ${open ? "bg-brand-tint text-brand-text" : "text-text-3 hover:bg-subtle"}`}><span className="grid h-5 w-5 place-items-center rounded-full border text-[10px]">{day.short}</span>{day.label}</button>
              {open ? allDay ? <><span className="rounded-md bg-brand-tint px-3 py-2 text-sm font-semibold text-brand-text">24 horas</span><button type="button" onClick={() => setDayAllDay(day.key, false)} className="inline-flex min-h-11 items-center text-xs font-semibold text-text-3 hover:text-foreground sm:min-h-9">Definir horario</button></> : <><Input aria-label={`${day.label}: abre`} type="time" value={interval?.start ?? "09:00"} onChange={(event) => setDayTime(day.key, "start", event.target.value)} className="h-11 w-36 sm:h-9 sm:w-28" /><span className="text-xs text-text-3">a</span><Input aria-label={`${day.label}: cierra`} type="time" value={interval?.end ?? "18:00"} onChange={(event) => setDayTime(day.key, "end", event.target.value)} className="h-11 w-36 sm:h-9 sm:w-28" /><button type="button" onClick={() => setDayAllDay(day.key, true)} className="inline-flex min-h-11 items-center text-xs font-semibold text-brand-text hover:underline sm:min-h-9">24 h</button></> : <span className="text-sm text-text-3">Cerrado</span>}
            </div>;
          })}
          <p className="mt-2 text-xs leading-5 text-text-3">Un cierre a las 00:00 termina al comenzar el día siguiente. Usa <strong className="font-semibold text-text-2">24 h</strong> para mantener ese día siempre abierto.</p>
        </div>}

        <div className="space-y-1.5"><Label htmlFor="business-timezone">Zona horaria</Label><TimezoneSelect id="business-timezone" value={settings.timezone} onValueChange={(timezone) => setSettings({ ...settings, timezone })} className="w-full" /><p className="text-xs text-text-3">Usa la zona del negocio, no la del servidor.</p></div>
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

  // Solo se manda lo que el dueño cambió, nunca `enabled` ni los controles de
  // piloto: guardar un tono no tiene por qué volver a encender (o a revisar la
  // puesta en marcha de) un agente.
  const changed: Partial<Profile> = {};
  if (form.name.trim() !== profile.name.trim()) changed.name = form.name.trim();
  for (const field of ["tone", "instructions", "escalationRules", "greeting"] as const) {
    if ((form[field] ?? "").trim() !== (profile[field] ?? "").trim()) changed[field] = form[field] ?? "";
  }
  const dirty = Object.keys(changed).length > 0;

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
            className="min-h-11"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="agent-tone">Tono</Label>
          <Input
            id="agent-tone"
            className="min-h-11"
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
            className="min-h-11"
            placeholder="Saludo para conversaciones nuevas"
            value={form.greeting ?? ""}
            onChange={(e) => setForm({ ...form, greeting: e.target.value })}
          />
        </div>
        <Button className="min-h-11" disabled={!dirty} onClick={() => void onSave(changed)}>Guardar comportamiento</Button>
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
  const [error, setError] = useState<string | null>(null);

  // Si el guardado falla, el texto se queda en el campo y se dice por qué:
  // antes se borraba igual y el paso "Añade información" seguía pendiente.
  async function saveEntry(body: Record<string, string>) {
    setError(null);
    const result = await postKbEntry(body);
    if (result.ok) return true;
    setError(result.message);
    return false;
  }

  async function addQa() {
    if (!question.trim() || !answer.trim()) return;
    if (!(await saveEntry({ kind: "qa", question, answer }))) return;
    setQuestion("");
    setAnswer("");
    onChanged();
  }

  async function addBlock() {
    if (!block.trim()) return;
    if (!(await saveEntry({ kind: "block", content: block }))) return;
    setBlock("");
    onChanged();
  }

  async function remove(id: string) {
    setError(null);
    const result = await saveResult(() => fetch(`/api/kb/${id}`, { method: "DELETE" }));
    if (!result.ok) {
      setError(result.message);
      return;
    }
    onChanged();
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Toda la información guardada</CardTitle>
            <CardDescription>
              Los datos de «Tu negocio», las preguntas frecuentes y cualquier
              texto suelto. Es lo único que tu agente afirma.
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
        {error && <p role="alert" className="rounded-md border border-danger-soft bg-danger-tint px-3 py-2 text-sm text-danger-text">{error}</p>}
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
            className="min-h-11"
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
          <Button size="sm" className="min-h-11" onClick={() => void addBlock()} disabled={!block.trim()}>
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
                className="h-11 w-11 shrink-0"
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

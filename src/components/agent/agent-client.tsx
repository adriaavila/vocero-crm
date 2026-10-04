"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Switch } from "@/components/ui/switch";
import { ChevronRight, Plus, Sparkles, Trash2 } from "lucide-react";
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
import { useSetup } from "@/components/agencia/activation-gate";
import { ActivarSection } from "@/components/agencia/activar";
import { useBusinessHours } from "@/components/agencia/horario-respuesta";
import { SetupProgressNav } from "@/components/agencia/setup-progress";
import { TuNegocio } from "@/components/agencia/tu-negocio";
import { SYSTEM_STATE_EVENT } from "@/components/agencia/allok/system-state";
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
  // El horario (solo SaaS) se edita dentro de «Tu negocio» y se guarda con su botón.
  const hours = useBusinessHours(saasMode);
  const [hoursOpen, setHoursOpen] = useState(false);
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
      if (window.location.hash === "#horario") setHoursOpen(true);
    };
    open();
    window.addEventListener("hashchange", open);
    return () => window.removeEventListener("hashchange", open);
  }, []);

  // Un enlace con ancla (/agent#activar) tiene que llegar a su sitio, y el
  // sitio se mueve mientras cargan el horario y la lectura de «Activar»: el
  // salto se hace UNA vez, cuando ya no queda nada por cargar encima.
  const ready = profile !== null;
  const jumped = useRef(false);
  useEffect(() => {
    if (jumped.current || !ready || gate.kind === "loading" || !hours.loaded) return;
    jumped.current = true;
    if (window.location.hash) document.getElementById(window.location.hash.slice(1))?.scrollIntoView({ block: "start" });
  }, [ready, gate.kind, hours.loaded]);

  if (!profile) {
    // Con la forma de lo que viene: el avance, «Tu negocio» (tres campos, horario,
    // regla, guardar) y «Activar». Así al cargar nada salta de sitio.
    return (
      <div className="h-full overflow-y-auto" aria-busy="true" aria-label="Cargando Tu agente">
        <header className="flex items-center justify-between gap-2 border-b px-4 py-3 sm:px-6 sm:py-4">
          <Skeleton className="h-5 w-28" />
          <Skeleton className="h-6 w-24 rounded-full" />
        </header>
        <div className="max-w-3xl space-y-4 p-4 sm:space-y-6 sm:p-6">
          <Skeleton className="h-4 w-72 max-w-full" />
          <Skeleton className="h-11 w-full" />
          <Card>
            <CardHeader>
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-4 w-full max-w-md" />
            </CardHeader>
            <CardContent className="space-y-5">
              {[0, 1, 2].map((n) => (
                <div key={n} className="space-y-1.5">
                  <Skeleton className="h-4 w-36" />
                  <Skeleton className="h-[74px] w-full" />
                </div>
              ))}
              <Skeleton className="h-16 w-full" />
              <div className="space-y-1.5">
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-[74px] w-full" />
              </div>
              <Skeleton className="h-11 w-44" />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <Skeleton className="h-5 w-40" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-24 w-full" />
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
    if (result.ok) {
      // El estado del lateral (el punto, «Pausado» / «all ok») se relee ya: sin
      // esto tardaba hasta un minuto en reflejar que se activó o se pausó.
      window.dispatchEvent(new Event(SYSTEM_STATE_EVENT));
      await refetch();
    }
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
      // Sin respuesta del servidor no sabemos qué pasó: se dice, y se puede reintentar.
      return result.network
        ? "No pudimos activarlo. Revisa tu conexión y vuelve a intentarlo."
        : result.message;
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
  const hasAnyHours = hours.settings
    ? hours.settings.responseMode === "all_day" || Object.values(hours.settings.weeklyHours).some((d) => d?.length)
    : true;

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
          hours={saasMode ? hours : null}
          hoursOpen={hoursOpen || (hours.loaded && !hasAnyHours)}
          onHoursOpenChange={setHoursOpen}
          brandName={brandNameLower}
          saveHandoff={(rules) => putProfile({ escalationRules: rules })}
          onChanged={refetch}
        />

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

"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  FlaskConical,
  MessageCircle,
  Play,
  Sparkles,
  TrendingDown,
  TrendingUp,
  XCircle,
} from "lucide-react";
import { useEvents } from "@/components/use-events";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type Run = {
  id: string;
  status: "running" | "done" | "failed";
  score: number | null;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
  delta: number | null;
};

type Hallazgo = {
  tipo: "alucinacion" | "fuera_de_kb" | "debio_escalar" | "tono";
  evidencia: string;
  sugerencia?: { pregunta: string; respuesta: string };
};

type Case = {
  id: string;
  persona: string;
  personaLabel: string;
  status: string;
  veredicto: "verde" | "amarillo" | "rojo" | null;
  hallazgos: Hallazgo[];
  transcript: { role: "cliente" | "agente"; text: string }[];
};

type LiveTest = {
  configured: boolean;
  status?: string;
  phone?: string | null;
  name?: string | null;
};

const TIPO_LABELS: Record<Hallazgo["tipo"], string> = {
  alucinacion: "Alucinación",
  fuera_de_kb: "Fuera del conocimiento",
  debio_escalar: "Debió escalar",
  tono: "Tono",
};

export function LabClient() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [aiConfigured, setAiConfigured] = useState(true);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ run: Run; cases: Case[] } | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState<LiveTest | null>(null);
  const [liveBusy, setLiveBusy] = useState(false);
  const [liveResult, setLiveResult] = useState<string | null>(null);

  const refetchRuns = useCallback(async () => {
    const res = await fetch("/api/lab/runs").catch(() => null);
    if (!res?.ok) return;
    const data = (await res.json()) as { runs: Run[]; aiConfigured: boolean };
    setRuns(data.runs);
    setAiConfigured(data.aiConfigured);
    if (!selectedRunId && data.runs[0]) setSelectedRunId(data.runs[0].id);
  }, [selectedRunId]);

  const refetchDetail = useCallback(async (runId: string) => {
    const res = await fetch(`/api/lab/runs/${runId}`).catch(() => null);
    if (!res?.ok) return;
    setDetail((await res.json()) as { run: Run; cases: Case[] });
  }, []);

  const refetchLive = useCallback(async () => {
    const res = await fetch("/api/lab/live", { cache: "no-store" }).catch(() => null);
    if (res?.ok) setLive((await res.json()) as LiveTest);
  }, []);

  useEffect(() => {
    void refetchRuns();
  }, [refetchRuns]);

  useEffect(() => {
    if (selectedRunId) void refetchDetail(selectedRunId);
  }, [selectedRunId, refetchDetail]);

  useEffect(() => {
    void refetchLive();
    const timer = window.setInterval(() => void refetchLive(), 5_000);
    return () => window.clearInterval(timer);
  }, [refetchLive]);

  useEvents({
    onLabRun: (data) => {
      setProgress(data.status === "running" ? data.progress : null);
      void refetchRuns();
      if (selectedRunId === data.runId || !selectedRunId) {
        setSelectedRunId(data.runId);
        void refetchDetail(data.runId);
      }
    },
  });

  async function launch() {
    setLaunching(true);
    setError(null);
    const res = await fetch("/api/lab/runs", { method: "POST" }).catch(() => null);
    setLaunching(false);
    if (!res) return;
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setError(data?.error?.message ?? "No se pudo lanzar la corrida");
      return;
    }
    const data = (await res.json()) as { runId: string };
    setSelectedRunId(data.runId);
    setProgress({ done: 0, total: 6 });
    void refetchRuns();
  }

  async function liveAction(action: "start" | "run") {
    setLiveBusy(true);
    setLiveResult(null);
    setError(null);
    const res = await fetch("/api/lab/live", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    }).catch(() => null);
    setLiveBusy(false);
    if (!res?.ok) {
      const data = (await res?.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setError(data?.error?.message ?? "No se pudo ejecutar la prueba real");
      return;
    }
    const data = (await res.json()) as { reply?: string };
    if (data.reply) setLiveResult(data.reply);
    await refetchLive();
  }

  const running = runs.some((r) => r.status === "running");

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <Header
        running={running}
        launching={launching}
        onLaunch={() => void launch()}
        disabled={!aiConfigured}
      />
      {error && <p className="px-6 pt-3 text-sm text-destructive">{error}</p>}

      {!aiConfigured && (
        <div className="mx-6 mt-4 rounded-lg border border-brand-soft bg-brand-tint p-4">
          <p className="flex items-center gap-2 text-sm font-medium">
            <Sparkles className="h-4 w-4 text-primary" /> Laboratorio interno deshabilitado
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            La prueba real con WAHA y NEA sí está disponible.
          </p>
        </div>
      )}

      {live?.configured && (
        <Card className="mx-6 mt-4">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <MessageCircle className="h-4 w-4 text-primary" /> Prueba real con tu WhatsApp
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center">
            {live.status?.startsWith("SCAN_QR") && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`/api/lab/live?qr=${Date.now()}`}
                alt="QR para vincular WhatsApp personal"
                className="h-44 w-44 rounded-md border bg-white p-2"
              />
            )}
            <div className="space-y-2">
              <p className="text-sm">
                Estado: <Badge variant={live.status === "WORKING" ? "success" : "warning"}>{live.status}</Badge>
              </p>
              {live.status === "WORKING" ? (
                <>
                  <p className="text-xs text-muted-foreground">
                    {live.name || "WhatsApp personal"}{live.phone ? ` · +${live.phone}` : ""}
                  </p>
                  <Button onClick={() => void liveAction("run")} disabled={liveBusy}>
                    <Play className="h-4 w-4" />
                    {liveBusy ? "Esperando respuesta…" : "Ejecutar prueba real"}
                  </Button>
                </>
              ) : (
                <>
                  <p className="max-w-md text-xs text-muted-foreground">
                    En tu teléfono abre WhatsApp → Dispositivos vinculados y escanea el QR.
                  </p>
                  <Button onClick={() => void liveAction("start")} disabled={liveBusy}>
                    {liveBusy ? "Iniciando…" : "Iniciar conexión"}
                  </Button>
                </>
              )}
              {liveResult && (
                <p className="max-w-xl rounded-md border bg-muted/40 p-3 text-sm">
                  <span className="font-medium">Respuesta del agente:</span> {liveResult}
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {running && progress && (
        <div className="mx-6 mt-4 rounded-lg border bg-card p-4">
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="font-medium">Evaluando personas…</span>
            <span className="text-muted-foreground">
              {progress.done} / {progress.total}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${(progress.done / progress.total) * 100}%` }}
            />
          </div>
        </div>
      )}

      <div className="grid gap-6 p-6 lg:grid-cols-[280px_1fr]">
        <HistoryList
          runs={runs}
          selectedRunId={selectedRunId}
          onSelect={setSelectedRunId}
        />
        {detail ? (
          <Report detail={detail} onApplied={() => void refetchDetail(detail.run.id)} />
        ) : (
          <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
            {runs.length === 0
              ? "Corre tu primera evaluación: 6 clientes simulados conversarán con tu agente y un juez calificará cada conversación."
              : "Elige una corrida del historial."}
          </div>
        )}
      </div>
    </div>
  );
}

function Header({
  running,
  launching,
  onLaunch,
  disabled,
}: {
  running: boolean;
  launching: boolean;
  onLaunch: () => void;
  disabled: boolean;
}) {
  return (
    <header className="flex items-center justify-between border-b px-6 py-4">
      <div>
        <h2 className="flex items-center gap-2 font-semibold">
          <FlaskConical className="h-4 w-4 text-primary" /> Laboratorio
        </h2>
        <p className="text-xs text-muted-foreground">
          Sandbox interno — no envía mensajes reales
        </p>
      </div>
      <Button onClick={onLaunch} disabled={disabled || running || launching}>
        <Play className="h-4 w-4" />
        {running ? "Corrida en curso…" : "Correr evaluación"}
      </Button>
    </header>
  );
}

function HistoryList({
  runs,
  selectedRunId,
  onSelect,
}: {
  runs: Run[];
  selectedRunId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Historial
      </p>
      {runs.length === 0 && (
        <p className="text-xs text-muted-foreground">Sin corridas todavía.</p>
      )}
      {runs.map((run) => (
        <button
          key={run.id}
          onClick={() => onSelect(run.id)}
          className={`w-full rounded-lg border p-3 text-left transition-colors hover:bg-accent/50 ${
            selectedRunId === run.id ? "border-primary/50 bg-accent/60" : "bg-card"
          }`}
        >
          <div className="flex items-center justify-between">
            <ScoreBadge run={run} />
            {run.delta !== null && run.delta !== 0 && (
              <span
                className={`flex items-center gap-0.5 text-xs font-medium ${
                  run.delta > 0 ? "text-success" : "text-destructive"
                }`}
              >
                {run.delta > 0 ? (
                  <TrendingUp className="h-3.5 w-3.5" />
                ) : (
                  <TrendingDown className="h-3.5 w-3.5" />
                )}
                {run.delta > 0 ? "+" : ""}
                {run.delta}
              </span>
            )}
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {new Date(run.startedAt).toLocaleString("es-MX", {
              day: "numeric",
              month: "short",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </p>
        </button>
      ))}
    </div>
  );
}

function ScoreBadge({ run }: { run: Run }) {
  if (run.status === "running") return <Badge variant="secondary">En curso…</Badge>;
  if (run.status === "failed") return <Badge variant="destructive">Fallida</Badge>;
  const score = run.score ?? 0;
  const variant = score >= 80 ? "success" : score >= 50 ? "warning" : "destructive";
  return <Badge variant={variant}>Score {score}</Badge>;
}

function Report({
  detail,
  onApplied,
}: {
  detail: { run: Run; cases: Case[] };
  onApplied: () => void;
}) {
  const { run, cases } = detail;
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Reporte</CardTitle>
            <ScoreBadge run={run} />
          </div>
          {run.status === "failed" && (
            <p className="text-sm text-destructive">
              La corrida falló: {run.error ?? "error desconocido"}. Vuelve a
              intentarlo.
            </p>
          )}
        </CardHeader>
        {run.status === "done" && (
          <CardContent>
            <div className="grid grid-cols-3 gap-3 text-center text-sm">
              {(["verde", "amarillo", "rojo"] as const).map((v) => (
                <div key={v} className="rounded-md border p-3">
                  <p className="text-2xl font-bold">
                    {cases.filter((c) => c.veredicto === v).length}
                  </p>
                  <p className="capitalize text-muted-foreground">{v}s</p>
                </div>
              ))}
            </div>
            {cases.some((c) => c.status === "judge_failed") && (
              <p className="mt-3 text-xs text-[#8a6d3b]">
                {cases.filter((c) => c.status === "judge_failed").length} caso(s) sin
                veredicto (el juez no respondió válido); excluidos del score.
              </p>
            )}
          </CardContent>
        )}
      </Card>

      {cases.map((c) => (
        <CaseCard key={c.id} testCase={c} onApplied={onApplied} />
      ))}
    </div>
  );
}

function CaseCard({ testCase, onApplied }: { testCase: Case; onApplied: () => void }) {
  const [open, setOpen] = useState(false);
  const c = testCase;
  const icon =
    c.veredicto === "verde" ? (
      <CheckCircle2 className="h-4 w-4 text-success" />
    ) : c.veredicto === "amarillo" ? (
      <AlertTriangle className="h-4 w-4 text-[#8a6d3b]" />
    ) : c.veredicto === "rojo" ? (
      <XCircle className="h-4 w-4 text-destructive" />
    ) : (
      <AlertTriangle className="h-4 w-4 text-muted-foreground" />
    );

  return (
    <Card>
      <CardHeader className="pb-3">
        <button
          className="flex w-full items-center justify-between"
          onClick={() => setOpen(!open)}
        >
          <span className="flex items-center gap-2 text-sm font-semibold">
            {icon}
            {c.personaLabel}
            {c.status === "judge_failed" && (
              <Badge variant="secondary">sin veredicto</Badge>
            )}
          </span>
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            {c.hallazgos.length > 0 && `${c.hallazgos.length} hallazgo(s)`}
            {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </span>
        </button>
      </CardHeader>
      {open && (
        <CardContent className="space-y-3">
          {c.hallazgos.map((h, i) => (
            <HallazgoCard key={i} hallazgo={h} caseId={c.id} index={i} onApplied={onApplied} />
          ))}
          <div className="rounded-md border bg-background/40 p-3">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Transcript
            </p>
            <div className="space-y-1.5 text-sm">
              {c.transcript.map((t, i) => (
                <p key={i}>
                  <span
                    className={
                      t.role === "cliente" ? "text-[#5b7291]" : "text-primary"
                    }
                  >
                    {t.role === "cliente" ? "Cliente" : "Agente"}:
                  </span>{" "}
                  {t.text}
                </p>
              ))}
            </div>
          </div>
        </CardContent>
      )}
    </Card>
  );
}

function HallazgoCard({
  hallazgo,
  caseId,
  index,
  onApplied,
}: {
  hallazgo: Hallazgo;
  caseId: string;
  index: number;
  onApplied: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [pregunta, setPregunta] = useState(hallazgo.sugerencia?.pregunta ?? "");
  const [respuesta, setRespuesta] = useState(hallazgo.sugerencia?.respuesta ?? "");
  const [applied, setApplied] = useState(false);
  const [saving, setSaving] = useState(false);

  async function apply() {
    setSaving(true);
    const res = await fetch("/api/lab/suggestions/apply", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ caseId, hallazgoIndex: index, pregunta, respuesta }),
    }).catch(() => null);
    setSaving(false);
    if (res?.ok) {
      setApplied(true);
      setEditing(false);
      onApplied();
    }
  }

  return (
    <div className="rounded-md border border-[#ece2cf] bg-[#faf7f0] p-3">
      <div className="flex items-center justify-between">
        <Badge variant="warning">{TIPO_LABELS[hallazgo.tipo]}</Badge>
        {hallazgo.sugerencia && !applied && !editing && (
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
            Agregar al conocimiento
          </Button>
        )}
        {applied && (
          <span className="text-xs text-success">Agregado al conocimiento ✓</span>
        )}
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        <span className="font-medium text-foreground">Evidencia:</span>{" "}
        {hallazgo.evidencia}
      </p>
      {editing && hallazgo.sugerencia && (
        <div className="mt-3 space-y-2 rounded-md border bg-card p-3">
          <div className="space-y-1">
            <Label htmlFor={`sug-q-${caseId}-${index}`}>Pregunta</Label>
            <Input
              id={`sug-q-${caseId}-${index}`}
              value={pregunta}
              onChange={(e) => setPregunta(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`sug-a-${caseId}-${index}`}>Respuesta</Label>
            <Textarea
              id={`sug-a-${caseId}-${index}`}
              rows={3}
              value={respuesta}
              onChange={(e) => setRespuesta(e.target.value)}
            />
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => void apply()}
              disabled={saving || !pregunta.trim() || !respuesta.trim()}
            >
              {saving ? "Guardando…" : "Guardar en el KB"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Cancelar
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

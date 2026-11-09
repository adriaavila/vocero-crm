"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, Loader2 } from "lucide-react";
import { StateDot } from "@/components/agencia/allok/mark";
import { SetupProgressNav } from "@/components/agencia/setup-progress";
import { useSetup } from "@/components/agencia/activation-gate";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { casesToFix, probarKind, resumenDeResultado, type CaseLite, type CaseToFix, type ProbarKind } from "@/lib/probar";
import { SETUP_STEP_CTA, type SetupStepKey } from "@/lib/setup-steps";
import type { SetupProgress } from "@/server/agencia/setup-progress";

/**
 * Capa de agencia: el paso «Probar», en palabras del dueño.
 *
 * Es el Laboratorio de siempre (seis clientes simulados, un juez) con una capa
 * encima que dice lo que el puntaje solo no dice: si la información cambió
 * desde entonces y, si hay casos para revisar, qué se corrige y dónde. El
 * puntaje aconseja, no bloquea: el dueño decide cuándo activar. La simulación nunca escribe a WhatsApp.
 */

/** `redCount`: casos graves de la corrida, que la lista de corridas ya trae. */
type Run = { id: string; status: "running" | "done" | "failed"; score: number | null; redCount?: number };

export function ProbarPanel({
  runs,
  running,
  launching,
  progress: runProgress,
  onLaunch,
  onApplied,
  initialProgress = null,
}: {
  runs: Run[];
  running: boolean;
  launching: boolean;
  /** Avance de la corrida en curso, si lo hay. */
  progress: { done: number; total: number } | null;
  onLaunch: () => void;
  /** Se agregó una respuesta al conocimiento: el reporte de abajo debe recargarse. */
  onApplied: () => void;
  initialProgress?: SetupProgress | null;
}) {
  const { progress, gate, reload } = useSetup(initialProgress);
  const latest = runs[0] ?? null;
  // null = el detalle todavía no llegó. El veredicto NO espera por él (sale de
  // `redCount`, que ya viene con la lista de corridas): solo la lista de casos.
  const [cases, setCases] = useState<CaseLite[] | null>(null);

  // El detalle de la última corrida terminada: de ahí salen los casos a corregir.
  const latestId = latest?.status === "done" ? latest.id : null;
  useEffect(() => {
    if (!latestId) {
      setCases([]);
      return;
    }
    let live = true;
    setCases(null);
    void fetch(`/api/lab/runs/${latestId}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { cases?: CaseLite[] } | null) => {
        if (live) setCases(data?.cases ?? []);
      })
      .catch(() => {
        if (live) setCases([]);
      });
    void reload();
    return () => {
      live = false;
    };
  }, [latestId, reload]);

  const probarDone = progress?.steps.find((step) => step.key === "probar")?.done ?? null;
  // Con el agente ya activo no hay a dónde «seguir»: solo el resultado y, si
  // quiere, probar de nuevo. Si no, el paso que falta después de probar (casi
  // siempre conectar WhatsApp): antes decía «Ya puedes activarlo» y llevaba a
  // Activar, donde lo primero era «Conecta tu WhatsApp».
  const agentOn = progress ? !progress.active : false;
  // «Puedes activarlo igual» es para quien aún no lo activó, no para un agente ya encendido.
  const activarDone = progress?.steps.find((step) => step.key === "activar")?.done ?? false;
  const next = agentOn ? null : (progress?.steps.find((step) => !step.done && step.key !== "probar") ?? null);
  const reds = latest?.redCount ?? (cases ?? []).filter((c) => c.veredicto === "rojo").length;
  const kind = probarKind({
    latest: latest ? { status: latest.status, score: latest.score } : null,
    cases: cases ?? [],
    redCount: reds,
    current: probarDone,
  });
  const toFix = kind === "revisar" ? casesToFix(cases ?? []) : [];
  const loadingCases = kind === "revisar" && cases === null;
  const busy = running || launching;

  return (
    <section aria-labelledby="probar-title" className="space-y-4">
      {progress && <SetupProgressNav progress={progress} page="probar" className="max-w-2xl" />}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle id="probar-title">{TITLE[kind]}</CardTitle>
            <Verdict kind={kind} score={latest?.score ?? null} reds={reds} />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="max-w-2xl text-sm leading-6 text-text-2" role="status">
            {kind === "en_curso" && runProgress
              ? `Seis clientes simulados están conversando con tu agente (${runProgress.done} de ${runProgress.total}).`
              : BODY[kind](latest?.score ?? null, reds, next?.key ?? null, gate.kind === "ready" && !activarDone)}
          </p>

          {loadingCases && (
            <div aria-busy="true" aria-label="Cargando lo que puedes corregir" className="space-y-3">
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          )}

          {toFix.length > 0 && (
            <ul className="space-y-3">
              {toFix.map((item) => (
                <CaseFix key={item.id} item={item} onApplied={() => { onApplied(); void reload(); }} />
              ))}
            </ul>
          )}

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            {(kind === "paso" || kind === "revisar") && next ? (
              <Link href={next.href} className={buttonVariants({ className: "min-h-11 w-full sm:w-auto" })}>
                {SETUP_STEP_CTA[next.key]}
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            ) : (
              <Button
                type="button"
                variant={kind === "paso" || kind === "revisar" ? "outline" : "default"}
                className="min-h-11 w-full sm:w-auto"
                disabled={busy}
                onClick={onLaunch}
              >
                {busy ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> Probando…
                  </>
                ) : kind === "sin_prueba" ? (
                  "Probar mi agente"
                ) : (
                  "Volver a probar"
                )}
              </Button>
            )}
            <p className="text-xs text-text-3">No se envía ningún mensaje a WhatsApp.</p>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}

const TITLE: Record<ProbarKind, string> = {
  sin_prueba: "Prueba tu agente antes de activarlo",
  en_curso: "Probando tu agente…",
  no_termino: "La prueba no pudo terminar",
  paso: "Tu agente salió bien de la prueba",
  vieja: "Vuelve a probar tu agente",
  revisar: "Ya probaste tu agente",
};

/** `next`: el paso que falta después de probar (null con el agente ya activo). */
const BODY: Record<ProbarKind, (score: number | null, reds: number, next: SetupStepKey | null, canActivate: boolean) => string> = {
  sin_prueba: () =>
    "Seis clientes simulados le escriben con casos reales: precios, dudas, reclamos. Un revisor califica cada respuesta, y así ves cómo contesta antes de que hable con tus clientes de verdad.",
  en_curso: () => "Seis clientes simulados están conversando con tu agente.",
  no_termino: () => "Hubo un problema al correr la prueba. Vuelve a intentarlo en un momento.",
  paso: (score, _reds, next) =>
    `Sacó ${score} de 100 y no tuvo problemas graves.${
      next === "whatsapp"
        ? " Ahora conecta tu WhatsApp para que les conteste a tus clientes."
        : next === "activar"
          ? " Ya puedes activarlo."
          : next
            ? " Sigue con el paso que falta."
            : ""
    }`,
  vieja: (score) =>
    `Sacó ${score} de 100, pero cambiaste tu información después de esa prueba. Vuelve a probar para asegurarte de que sigue contestando bien.`,
  // «Puedes activarlo igual» solo cuando Activar de verdad deja (la misma lectura,
  // `gate`): con WhatsApp sin conectar sería prometer lo que todavía no se puede.
  revisar: (score, reds, _next, canActivate) =>
    `${resumenDeResultado(score, reds) ?? ""}${canActivate ? " Puedes activarlo igual: tú decides si ya te gusta cómo responde." : ""} Si quieres mejorarlo, esto es lo que puedes corregir y volver a probar.`.trim(),
};

function Verdict({ kind, score, reds }: { kind: ProbarKind; score: number | null; reds: number }) {
  const grave = kind === "revisar" && reds > 0;
  const view =
    kind === "paso"
      ? { state: "activo" as const, word: score !== null ? `${score} de 100` : "Aprobado" }
      : kind === "revisar" || kind === "vieja" || kind === "no_termino"
        ? { state: "atencion" as const, word: kind === "revisar" && score !== null ? `${score} de 100` : kind === "vieja" ? "Por repetir" : "Sin resultado" }
        : kind === "en_curso"
          ? { state: "atendiendo" as const, word: "En curso" }
          : { state: "pausado" as const, word: "Sin probar" };
  return (
    <span className="inline-flex items-center gap-2 text-sm font-medium">
      {grave ? <GraveDot /> : <StateDot state={view.state} size={8} decorative />}
      {view.word}
    </span>
  );
}

/** El punto de un caso grave: rojo, el mismo color con que el reporte marca el caso. El rojo no es un estado, es un fallo. */
function GraveDot() {
  return <span aria-hidden="true" className="inline-block h-2 w-2 shrink-0 rounded-full bg-destructive" />;
}

function CaseFix({ item, onApplied }: { item: CaseToFix; onApplied: () => void }) {
  return (
    <li className="rounded-md border border-border p-3">
      <p className="flex items-center gap-2 text-sm font-semibold">
        {item.red ? <GraveDot /> : <StateDot state="pausado" size={8} decorative />}
        <span className="break-words">{item.label}</span>
        <span className="whitespace-nowrap text-xs font-normal text-text-3">{item.red ? "Grave" : "A mejorar"}</span>
      </p>
      <ul className="mt-2 space-y-3">
        {item.hallazgos.map((h) => (
          <li key={h.index} className="text-sm">
            <p>{h.fix.what}</p>
            <p className="mt-0.5 break-words text-xs leading-5 text-text-3">Lo que pasó: «{h.evidencia}»</p>
            {h.fix.suggestion ? (
              <AddAnswer caseId={item.id} index={h.index} suggestion={h.fix.suggestion} onApplied={onApplied} />
            ) : (
              <Link
                href={h.fix.to.href}
                className={buttonVariants({ variant: "outline", size: "sm", className: "mt-1 min-h-11" })}
              >
                {h.fix.to.label}
              </Link>
            )}
          </li>
        ))}
        {item.hallazgos.length === 0 && <li className="text-xs text-text-3">Sin detalle; vuelve a probar.</li>}
      </ul>
    </li>
  );
}

/** Agrega al conocimiento la respuesta que propuso el revisor, editable antes de guardar. */
function AddAnswer({
  caseId,
  index,
  suggestion,
  onApplied,
}: {
  caseId: string;
  index: number;
  suggestion: { pregunta: string; respuesta: string };
  onApplied: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [pregunta, setPregunta] = useState(suggestion.pregunta);
  // La pregunta viene del revisor; la RESPUESTA la escribe el dueño. Una
  // respuesta propuesta por un modelo se guardaría con un clic y el agente la
  // repetiría como un hecho del negocio.
  const [respuesta, setRespuesta] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  async function apply() {
    setState("saving");
    setError(null);
    const response = await fetch("/api/lab/suggestions/apply", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ caseId, hallazgoIndex: index, pregunta, respuesta }),
    }).catch(() => null);
    if (!response?.ok) {
      const payload = (await response?.json().catch(() => null)) as { error?: { message?: string } } | null;
      setError(payload?.error?.message ?? "No se pudo guardar. Revisa el texto y vuelve a intentarlo.");
      setState("idle");
      return;
    }
    setState("done");
    onApplied();
  }

  if (state === "done") {
    return <p className="mt-1 text-sm text-success-text">Agregada a tu información. Vuelve a probar para comprobarlo.</p>;
  }
  if (!open) {
    return (
      <Button type="button" variant="outline" size="sm" className="mt-1 min-h-11" onClick={() => setOpen(true)}>
        Agregar esta respuesta
      </Button>
    );
  }
  return (
    <div className="mt-2 space-y-3 rounded-md border border-border-strong bg-subtle p-3">
      <div className="space-y-1.5">
        <Label htmlFor={`fix-q-${caseId}-${index}`}>Pregunta</Label>
        <Textarea id={`fix-q-${caseId}-${index}`} rows={2} className="resize-y break-words" value={pregunta} onChange={(e) => setPregunta(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`fix-a-${caseId}-${index}`}>Respuesta</Label>
        <Textarea id={`fix-a-${caseId}-${index}`} rows={3} className="resize-y" value={respuesta} onChange={(e) => setRespuesta(e.target.value)} />
        <p className="text-xs text-text-3">Escríbela tú, con lo que de verdad responderías: tu agente la repetirá tal cual.</p>
      </div>
      {error && (
        <p role="alert" className="rounded-md border border-danger-soft bg-danger-tint px-3 py-2 text-sm text-danger-text">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="button" className="min-h-11" disabled={state === "saving" || !pregunta.trim() || !respuesta.trim()} onClick={() => void apply()}>
          {state === "saving" ? "Guardando…" : "Guardar respuesta"}
        </Button>
        <Button type="button" variant="ghost" className="min-h-11" onClick={() => setOpen(false)}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}

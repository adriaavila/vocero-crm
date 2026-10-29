"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowRight, Loader2, Moon, SunMoon } from "lucide-react";
import { StateDot } from "@/components/agencia/allok/mark";
import type { GateState } from "@/components/agencia/activation-gate";
import { allDayDetail, type HoursController, type HoursSettings } from "@/components/agencia/horario-respuesta";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { describeTeamHours } from "@/lib/horario";
import type { ActivationSummary } from "@/server/agencia/activacion";

/**
 * Capa de agencia: el último paso, «Activar».
 *
 * Encender el agente hace que le hable a los clientes del negocio, así que el
 * botón no aparece solo: primero se ve a qué número va a contestar, cuándo,
 * y con qué reglas. Si falta algo, la tarjeta dice qué y lleva a arreglarlo
 * (la lista es la misma que aplica el servidor al encender). Si no se pudo
 * saber qué falta, no hay botón: reintentar. Pausar, en cambio, es inmediato.
 */

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 py-3 sm:grid-cols-[9rem_1fr] sm:gap-4">
      <dt className="kicker pt-0.5">{label}</dt>
      <dd className="min-w-0 break-words text-sm leading-6">{children}</dd>
    </div>
  );
}

type Mode = HoursSettings["responseMode"];

/**
 * «Cuándo responde», elegido aquí mismo con dos opciones en palabras de dueño.
 * Antes la regla solo se leía, y quien probaba su agente escribiéndole a media
 * tarde no recibía respuesta («Fuera de horario» calla mientras el equipo
 * atiende) sin saber por qué. Se guarda al tocar (solo el modo: ver
 * `saveMode`) y la frase de «ahora» se vuelve a leer del servidor.
 */
function ModoRespuesta({ hours, onChange }: { hours: HoursController; onChange?: () => void }) {
  const [busy, setBusy] = useState<Mode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const settings = hours.settings;
  if (!settings) return null;
  const current = settings.responseMode;
  const team = describeTeamHours(settings);

  async function choose(mode: Mode) {
    if (mode === current || busy) return;
    setBusy(mode);
    setError(null);
    const result = await hours.saveMode(mode);
    setBusy(null);
    if (!result.ok) setError(result.message);
    else onChange?.();
  }

  const options: { mode: Mode; icon: typeof Moon; title: string; detail: string; locked: boolean }[] = [
    {
      mode: "all_day",
      icon: SunMoon,
      title: "Todo el día",
      detail: allDayDetail(hours.canUseAllDay),
      locked: !hours.canUseAllDay,
    },
    {
      mode: "outside_hours",
      icon: Moon,
      title: "Cuando no atiendes tú",
      detail: team ? `Atiendes tú ${team}. Tu agente, el resto del tiempo.` : "Tú eliges en qué horas atiendes tú.",
      locked: false,
    },
  ];

  return (
    <div className="space-y-2">
      <div role="radiogroup" aria-label="Cuándo responde tu agente" className="grid gap-2">
        {options.map(({ mode, icon: Icon, title, detail, locked }) => {
          const selected = current === mode;
          return (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={locked || busy !== null}
              onClick={() => void choose(mode)}
              className={`flex w-full min-h-11 items-start gap-3 rounded-lg border p-3 text-left transition-colors duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed ${
                selected ? "border-brand bg-brand-tint" : "border-border-strong hover:border-foreground"
              } ${locked ? "opacity-55" : ""}`}
            >
              {busy === mode ? (
                <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-brand-text motion-reduce:animate-none" aria-hidden="true" />
              ) : (
                <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${selected ? "text-brand-text" : "text-text-3"}`} aria-hidden="true" />
              )}
              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  {title} {locked && <Badge variant="secondary">Plan Completo</Badge>}
                </span>
                <span className="mt-0.5 block text-xs leading-5 text-text-2">{detail}</span>
              </span>
            </button>
          );
        })}
      </div>
      {error && (
        <p role="alert" className="text-xs leading-5 text-danger-text">
          {error}
        </p>
      )}
    </div>
  );
}

function Summary({
  activation,
  hours,
  onScheduleChange,
}: {
  activation: ActivationSummary;
  hours?: HoursController | null;
  onScheduleChange?: () => void;
}) {
  const { number, schedule, handoff, handoffSuggested, restrictions, knowledgeCount, enforced } = activation;
  const choosing = Boolean(hours?.settings);
  return (
    <dl className="divide-y divide-border rounded-md border border-border px-4">
      <Row label="Número">
        {number ? (
          <>
            <span className="font-medium tabular-nums">{number.display ?? "Tu número"}</span>
            {number.name && <span className="text-text-2"> · {number.name}</span>}
          </>
        ) : (
          <span className="text-text-2">Todavía sin número conectado.</span>
        )}
      </Row>
      <Row label="Cuándo responde">
        {schedule ? (
          <div className="space-y-2">
            {/* Con la elección a la vista, la regla escrita sobra: la dice la opción marcada. */}
            {choosing && hours ? <ModoRespuesta hours={hours} onChange={onScheduleChange} /> : <p>{schedule.rule}</p>}
            <p className="text-text-2">
              {schedule.now} <span className="text-text-3">({schedule.timezone})</span>
            </p>
            {choosing && hours?.settings?.responseMode === "outside_hours" && (
              // Un ancla de esta misma pantalla: abre el horario dentro de «Más ajustes».
              <a
                href="#horario"
                className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-brand-text hover:underline"
              >
                Cambiar mis horas
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </a>
            )}
          </div>
        ) : enforced ? (
          <span className="text-text-2">Todavía sin horario.</span>
        ) : (
          // Fuera del SaaS no hay horario de respuesta: contesta apenas llega.
          <span>Responde apenas llega el mensaje.</span>
        )}
      </Row>
      <Row label="Qué hará">
        <ul className="list-disc space-y-1 pl-4 marker:text-text-3">
          <li>
            Responde con lo que escribiste en «Tu negocio»
            {knowledgeCount > 0 ? ` (${knowledgeCount} ${knowledgeCount === 1 ? "dato" : "datos"}).` : "."} Lo que no sabe, no lo inventa.
          </li>
          {handoff && (
            <li>
              {handoffSuggested ? (
                <>
                  Te pasa la conversación en estos casos, que es una sugerencia que puedes cambiar en «Tu negocio»:{" "}
                </>
              ) : (
                <>Te pasa la conversación según tu regla: </>
              )}
              <span className="text-text-2">«{handoff.length > 220 ? `${handoff.slice(0, 220).trimEnd()}…` : handoff}»</span>
            </li>
          )}
          {restrictions.map((restriction) => (
            <li key={restriction}>{restriction}</li>
          ))}
          <li>Puedes pausarlo cuando quieras, desde aquí o desde el interruptor de arriba.</li>
        </ul>
      </Row>
    </dl>
  );
}

export function ActivarSection({
  enabled,
  gate,
  onRetry,
  onActivate,
  onPause,
  hours = null,
  onScheduleChange,
}: {
  enabled: boolean;
  gate: GateState;
  onRetry: () => void;
  /** Devuelve el motivo si el servidor no dejó activar, o null si quedó activo. */
  onActivate: () => Promise<string | null>;
  onPause: () => Promise<void>;
  /** El horario de Tu negocio (solo SaaS): «Cuándo responde» se elige aquí mismo. */
  hours?: HoursController | null;
  /** Tras cambiar el modo: volver a leer lo que dice «ahora» y qué falta. */
  onScheduleChange?: () => void;
}) {
  const [busy, setBusy] = useState<"activar" | "pausar" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [justActivated, setJustActivated] = useState(false);
  const pauseButton = useRef<HTMLButtonElement>(null);

  async function activate() {
    setBusy("activar");
    setError(null);
    const reason = await onActivate();
    setBusy(null);
    if (reason) setError(reason);
    else setJustActivated(true);
  }

  async function pause() {
    setBusy("pausar");
    setError(null);
    setJustActivated(false);
    await onPause();
    setBusy(null);
  }

  // Al activar, el botón que se oprimió desaparece: el foco pasa a «Pausar», que
  // es lo que ahora hay que poder hacer, y no se pierde en el documento.
  useEffect(() => {
    if (enabled && justActivated) pauseButton.current?.focus();
  }, [enabled, justActivated]);

  const activation = gate.kind === "blocked" || gate.kind === "ready" ? gate.activation : null;
  const blockers = activation?.blockers ?? [];

  return (
    <Card id="activar" tabIndex={-1} className="scroll-mt-4 outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>Activar tu agente</CardTitle>
          {enabled ? (
            <span className="inline-flex items-center gap-2 text-sm font-medium">
              <StateDot state="activo" size={8} decorative /> Activo
            </span>
          ) : (
            <span className="inline-flex items-center gap-2 text-sm font-medium text-text-2">
              <StateDot state="pausado" size={8} decorative /> En pausa
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Lo que se acaba de hacer, dicho en voz alta para quien no ve la pantalla. */}
        <p role="status" className={justActivated && enabled ? "text-sm font-medium" : "sr-only"}>
          {justActivated && enabled
            ? `Tu agente está activo. ${activation?.schedule?.now ?? "Responde apenas llega un mensaje."}`
            : ""}
        </p>

        {gate.kind === "loading" && (
          <div className="space-y-2" aria-busy="true" aria-label="Revisando tu configuración">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-24 w-full" />
          </div>
        )}

        {gate.kind === "error" && (
          <div role="alert" className="space-y-3 rounded-md border border-danger-soft bg-danger-tint p-4">
            <p className="flex items-start gap-2 text-sm font-medium text-danger-text">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              {enabled
                ? "No pudimos revisar tu configuración. Tu agente sigue como estaba."
                : "No pudimos revisar tu configuración, así que no se puede activar todavía."}
            </p>
            <Button type="button" variant="outline" className="min-h-11" onClick={onRetry}>
              Reintentar
            </Button>
          </div>
        )}

        {activation && (
          <>
            {enabled && <Summary activation={activation} hours={hours} onScheduleChange={onScheduleChange} />}

            {blockers.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium">
                  {enabled
                    ? "Tu agente sigue activo, pero conviene revisar:"
                    : gate.kind === "blocked"
                      ? "Antes de activar falta:"
                      : "Te recomendamos revisar:"}
                </p>
                <ul className="space-y-2">
                  {blockers.map((blocker) => (
                    <li
                      key={`${blocker.code}-${blocker.title}`}
                      className="flex flex-col gap-2 rounded-md border border-warning-soft bg-warning-tint p-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0">
                        <p className="break-words text-sm font-semibold">{blocker.title}</p>
                        <p className="break-words text-xs leading-5 text-text-2">{blocker.detail}</p>
                      </div>
                      {blocker.href && blocker.cta && (
                        // Un ancla de esta misma pantalla es un enlace normal: así el
                        // navegador avisa del cambio de ancla y el cajón de destino
                        // (Avanzado, Horario) se abre.
                        blocker.href.startsWith("/agent#") ? (
                          <a href={blocker.href.slice("/agent".length)} className={buttonVariants({ variant: "outline", className: "min-h-11 shrink-0" })}>
                            {blocker.cta}
                          </a>
                        ) : (
                          <Link href={blocker.href} className={buttonVariants({ variant: "outline", className: "min-h-11 shrink-0" })}>
                            {blocker.cta}
                          </Link>
                        )
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {!enabled && gate.kind === "ready" && blockers.length === 0 && (
              <p className="text-sm text-text-2">Todo está listo. Esto es lo que va a pasar cuando actives:</p>
            )}
            {!enabled && gate.kind === "ready" && (
              <Summary activation={activation} hours={hours} onScheduleChange={onScheduleChange} />
            )}
          </>
        )}

        {error && (
          <p role="alert" className="rounded-md border border-danger-soft bg-danger-tint px-3 py-2 text-sm text-danger-text">
            {error}
          </p>
        )}

        {/* Pausar nunca depende de la lectura: frenar al agente tiene que poder hacerse siempre. */}
        {enabled && (
          <Button
            ref={pauseButton}
            type="button"
            variant="outline"
            className="min-h-11"
            disabled={busy !== null}
            onClick={() => void pause()}
          >
            {busy === "pausar" ? "Pausando…" : "Pausar mi agente"}
          </Button>
        )}
        {!enabled && gate.kind === "ready" && (
          <Button type="button" className="min-h-11 w-full sm:w-auto" disabled={busy !== null} onClick={() => void activate()}>
            {busy === "activar" ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> Activando…
              </>
            ) : (
              <>
                {blockers.length > 0 ? "Activar de todas formas" : "Activar mi agente"}
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </>
            )}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

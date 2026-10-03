"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowRight, Loader2 } from "lucide-react";
import { StateDot } from "@/components/agencia/allok/mark";
import type { GateState } from "@/components/agencia/activation-gate";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
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

function Summary({ activation }: { activation: ActivationSummary }) {
  const { number, schedule, handoff, handoffSuggested, restrictions, knowledgeCount, enforced } = activation;
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
          <>
            <p>{schedule.rule}</p>
            <p className="text-text-2">
              {schedule.now} <span className="text-text-3">({schedule.timezone})</span>
            </p>
          </>
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
}: {
  enabled: boolean;
  gate: GateState;
  onRetry: () => void;
  /** Devuelve el motivo si el servidor no dejó activar, o null si quedó activo. */
  onActivate: () => Promise<string | null>;
  onPause: () => Promise<void>;
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
            {enabled && <Summary activation={activation} />}

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
            {!enabled && gate.kind === "ready" && <Summary activation={activation} />}
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

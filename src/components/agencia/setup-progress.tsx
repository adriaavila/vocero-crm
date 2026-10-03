import Link from "next/link";
import { StateDot } from "@/components/agencia/allok/mark";
import type { SystemState } from "@/lib/estado";
import type { SetupProgress, SetupStepKey } from "@/lib/setup-steps";
import { cn } from "@/lib/utils";

/**
 * Capa de agencia: el avance de la puesta en marcha, el mismo en toda pantalla
 * de configuración y en Inicio. Los cuatro pasos salen de `lib/setup-steps`
 * (derivados de la preparación del servidor); aquí solo se dibujan.
 *
 * Cada paso es punto + palabra: listo es *all ok* (verde, «Listo»), el que toca
 * es un punto de tinta («Ahora») y los demás quedan quietos (gris,
 * «Pendiente»). El de ahora NO va en ámbar: el ámbar es «algo espera por una
 * persona» y aquí no hay nada roto. Sin cifras («paso 2 de 4» no dice nada que
 * el punto no diga, y era justo el contador que se desactualizaba).
 *
 * En el teléfono es una sola fila: los cuatro puntos y el nombre del paso de
 * ahora. Cuatro celdas con rótulo empujaban la acción principal bajo el pliegue.
 */

type Kind = "done" | "current" | "later";
const WORD: Record<Kind, string> = { done: "Listo", current: "Ahora", later: "Pendiente" };

/** El punto de un paso: verde de estado si está listo, tinta si toca, gris si falta. */
function StepDot({ kind, size = 8 }: { kind: Kind; size?: number }) {
  if (kind === "current") {
    return (
      <span
        aria-hidden
        className="inline-block shrink-0 rounded-full bg-foreground"
        style={{ width: size, height: size }}
      />
    );
  }
  const state: SystemState = kind === "done" ? "activo" : "pausado";
  return <StateDot state={state} size={size} decorative className="shrink-0" />;
}

export function SetupProgressNav({
  progress,
  page,
  className,
}: {
  progress: SetupProgress;
  /** El paso al que pertenece esta pantalla (se marca como la página actual). */
  page?: SetupStepKey;
  className?: string;
}) {
  // Con el agente activo ya no hay puesta en marcha que dibujar.
  if (!progress.active) return null;
  const kindOf = (step: SetupProgress["steps"][number]): Kind =>
    step.done ? "done" : step.key === progress.current ? "current" : "later";
  const current = progress.steps.find((step) => step.key === progress.current);

  return (
    <nav aria-label="Pasos para activar tu agente" className={className}>
      {/* Teléfono: una fila, cuatro puntos y el paso de ahora. */}
      <ol className="flex items-center sm:hidden">
        {progress.steps.map((step) => {
          const kind = kindOf(step);
          return (
            <li key={step.key}>
              <Link
                href={step.href}
                aria-label={`${step.label}: ${WORD[kind].toLowerCase()}`}
                aria-current={page === step.key ? "page" : undefined}
                className="flex h-11 w-9 items-center justify-center rounded-sm"
              >
                <StepDot kind={kind} size={kind === "current" ? 12 : 10} />
              </Link>
            </li>
          );
        })}
        {current && (
          <li className="ml-2 min-w-0 text-[13.5px] leading-5">
            <span className="font-semibold">{current.label}</span>
            <span className="text-text-3"> · {WORD.current}</span>
          </li>
        )}
      </ol>

      {/* Tableta y escritorio: los cuatro pasos con su palabra. */}
      <ol className="hidden grid-cols-4 gap-x-4 sm:grid">
        {progress.steps.map((step) => {
          const kind = kindOf(step);
          return (
            <li key={step.key} className="min-w-0">
              <Link
                href={step.href}
                aria-current={page === step.key ? "page" : undefined}
                className="group block min-h-11 rounded-sm"
              >
                <span
                  aria-hidden
                  className={cn(
                    "block h-0.5 rounded-full",
                    kind === "done" && "bg-success",
                    kind === "current" && "bg-foreground",
                    kind === "later" && "bg-border-strong",
                  )}
                />
                <span className="mt-2 flex items-start gap-2">
                  <span className="mt-[7px] flex shrink-0">
                    <StepDot kind={kind} />
                  </span>
                  <span className="min-w-0">
                    <span
                      className={cn(
                        "block text-[13.5px] font-semibold leading-5 group-hover:underline",
                        kind === "later" ? "text-text-3" : "text-foreground",
                      )}
                    >
                      {step.label}
                    </span>
                    <span className="block text-xs text-text-3">{WORD[kind]}</span>
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

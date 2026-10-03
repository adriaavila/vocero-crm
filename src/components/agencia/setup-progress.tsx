import Link from "next/link";
import { StateDot } from "@/components/agencia/allok/mark";
import type { SystemState } from "@/lib/estado";
import { cn } from "@/lib/utils";
import type { SetupStepKey } from "@/lib/setup-steps";
import type { SetupProgress } from "@/server/agencia/setup-progress";

/**
 * Capa de agencia: el avance de la puesta en marcha, el mismo en toda pantalla
 * de configuración (no incluye Inicio). Los cuatro pasos salen de
 * `server/agencia/setup-progress.ts`; aquí solo se dibujan.
 *
 * Cada paso es un estado de la marca, siempre punto + palabra: listo es
 * «all ok» (verde), el que toca ahora «te toca a ti» (ámbar) y los demás
 * quedan quietos (gris). Sin cifras: «paso 2 de 4» no dice nada que el punto
 * no diga, y era justo el contador que se desactualizaba.
 */

const STATE: Record<"done" | "current" | "later", { state: SystemState; word: string }> = {
  done: { state: "activo", word: "Listo" },
  current: { state: "atencion", word: "Ahora" },
  later: { state: "pausado", word: "Pendiente" },
};

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
  return (
    <nav aria-label="Pasos para activar tu agente" className={className}>
      <ol className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
        {progress.steps.map((step) => {
          const kind = step.done ? "done" : step.key === progress.current ? "current" : "later";
          const { state, word } = STATE[kind];
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
                  <StateDot state={state} size={8} decorative className="mt-[7px] shrink-0" />
                  <span className="min-w-0">
                    <span
                      className={cn(
                        "block text-[13.5px] font-semibold leading-5",
                        kind === "later" ? "text-text-3" : "text-foreground",
                        "group-hover:underline",
                      )}
                    >
                      {step.label}
                    </span>
                    <span className="block text-xs text-text-3">{word}</span>
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

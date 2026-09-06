"use client";

import { useCallback, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

/**
 * Capa de agencia — el freno antes de encender el agente.
 *
 * En upstream, una instancia la configura su propio dueño: si enciende el
 * agente a medias, lo descubre él. Aquí la instancia se ENTREGA a un cliente,
 * y el agente medio configurado le contesta a los leads DEL CLIENTE. Así que
 * encender no es un toggle: primero se consulta `/api/readiness` y, si algo
 * falta, se enseña qué falta. Se puede seguir de todas formas — es una
 * advertencia informada, no un candado.
 *
 * Apagar nunca pregunta: frenar al bot tiene que ser instantáneo.
 */

type Step = { status: string; label: string; detail: string };

export function useActivationGate(input: {
  enabled: boolean;
  onConfirm: (enabled: boolean) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [pending, setPending] = useState<Step[]>([]);
  const { enabled, onConfirm } = input;

  const toggle = useCallback(async () => {
    if (enabled) return onConfirm(false);

    const readiness = (await fetch("/api/readiness")
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)) as {
      overall?: string;
      steps?: Step[];
    } | null;

    // Sin readiness (endpoint caído, instancia vieja) se enciende igual: este
    // freno es una ayuda, y una ayuda que no responde no puede bloquear el
    // trabajo del dueño.
    if (readiness?.overall === "needs_attention") {
      setPending(readiness.steps?.filter((s) => s.status !== "complete") ?? []);
      dialog.current?.showModal();
      return;
    }
    onConfirm(true);
  }, [enabled, onConfirm]);

  const gate = (
    <ActivationGate
      ref={dialog}
      steps={pending}
      onConfirm={() => {
        dialog.current?.close();
        onConfirm(true);
      }}
    />
  );

  return { toggle, gate };
}

export function ActivationGate({
  ref,
  steps,
  onConfirm,
}: {
  ref: React.Ref<HTMLDialogElement>;
  steps: Step[];
  onConfirm: () => void;
}) {
  return (
    <dialog
      ref={ref}
      className="w-[min(32rem,calc(100vw-2rem))] rounded-lg border bg-card p-0 text-foreground shadow-pop backdrop:bg-black/35"
    >
      <div className="border-b p-5">
        <h3 className="font-semibold">Aún hay pasos pendientes</h3>
        <p className="mt-1 text-sm text-text-3">
          Puedes activar el agente, pero recomendamos revisar esto primero.
        </p>
      </div>
      <div className="space-y-2 p-5">
        {steps.map((step) => (
          <div key={step.label} className="rounded-md border p-3">
            <p className="text-sm font-semibold">{step.label}</p>
            <p className="mt-0.5 text-xs text-text-3">{step.detail}</p>
          </div>
        ))}
      </div>
      <div className="flex justify-end gap-2 border-t p-4">
        <Button
          variant="ghost"
          onClick={(e) => e.currentTarget.closest("dialog")?.close()}
        >
          Volver y corregir
        </Button>
        <Button onClick={onConfirm}>Activar de todas formas</Button>
      </div>
    </dialog>
  );
}

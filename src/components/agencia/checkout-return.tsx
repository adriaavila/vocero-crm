"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { StateDot } from "@/components/agencia/allok/mark";

const POLL_MS = 2_000;
const WAIT_MS = 45_000;

type Status = { hasSubscription?: boolean; agentAllowed?: boolean; updatedAt?: string | null };

async function readStatus(): Promise<Status | null> {
  try {
    const response = await fetch("/api/saas/billing/status", { cache: "no-store" });
    return response.ok ? ((await response.json()) as Status) : null;
  } catch {
    return null;
  }
}

/**
 * Vuelve del portal de Stripe: el cambio (plan, cancelación, pago) llega por
 * webhook unos segundos después que el dueño. Mira el estado un rato y, apenas
 * cambie, recarga la pantalla; sin recargar a ciegas ni dejar la vista vieja.
 */
export function useBillingSync({ enabled, knownUpdatedAt }: { enabled: boolean; knownUpdatedAt: string | null }) {
  const router = useRouter();
  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    const started = Date.now();
    const tick = async () => {
      if (stopped) return;
      const status = await readStatus();
      if (stopped) return;
      if (status && (status.updatedAt ?? null) !== knownUpdatedAt) {
        router.refresh();
        return;
      }
      if (Date.now() - started < 20_000) timer = setTimeout(() => void tick(), POLL_MS);
    };
    let timer = setTimeout(() => void tick(), POLL_MS);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [enabled, knownUpdatedAt, router]);
}

/**
 * Lo que se ve al volver de Checkout. El pago ya salió, pero el plan se activa
 * cuando llega el webhook: la pantalla lo dice en palabras y se actualiza sola,
 * en vez de pedirle al dueño que recargue y adivinar si funcionó.
 */
export function CheckoutReturn({ settled }: { settled: boolean }) {
  const router = useRouter();
  const [phase, setPhase] = useState<"waiting" | "done" | "slow">(settled ? "done" : "waiting");
  const [attempt, setAttempt] = useState(0);
  const refreshed = useRef(false);

  useEffect(() => {
    if (settled) setPhase("done");
  }, [settled]);

  useEffect(() => {
    if (phase !== "waiting") return;
    let stopped = false;
    const started = Date.now();
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      const status = await readStatus();
      if (stopped) return;
      if (status?.hasSubscription && status.agentAllowed) {
        setPhase("done");
        if (!refreshed.current) {
          refreshed.current = true;
          router.refresh();
        }
        return;
      }
      if (Date.now() - started >= WAIT_MS) {
        setPhase("slow");
        return;
      }
      timer = setTimeout(() => void tick(), POLL_MS);
    };
    void tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [phase, attempt, router]);

  const retry = useCallback(() => {
    setPhase("waiting");
    setAttempt((n) => n + 1);
  }, []);

  return (
    <div
      role="status"
      aria-live="polite"
      className="mb-6 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-info-soft bg-info-tint px-4 py-3 text-sm leading-relaxed text-info-text"
    >
      <StateDot state={phase === "done" ? "activo" : phase === "slow" ? "atencion" : "atendiendo"} size={14} decorative motion />
      <span className="min-w-0 flex-1">
        {phase === "done" && "Listo: tu plan está activo y tu agente ya puede contestar."}
        {phase === "waiting" && "Pago recibido. Estamos activando tu plan, esto toma unos segundos."}
        {phase === "slow" && "Tu pago se está confirmando. Puede tardar unos minutos; tu agente vuelve a contestar solo cuando termine."}
      </span>
      {phase === "slow" && (
        <button
          type="button"
          onClick={retry}
          className="inline-flex min-h-11 items-center rounded-[10px] border border-border-strong px-4 text-sm font-semibold transition-[border-color,transform] hover:border-foreground active:scale-[0.97]"
        >
          Revisar de nuevo
        </button>
      )}
    </div>
  );
}

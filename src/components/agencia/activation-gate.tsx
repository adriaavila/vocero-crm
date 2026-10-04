"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ActivationSummary } from "@/server/agencia/activacion";
import type { SetupProgress } from "@/server/agencia/setup-progress";

/**
 * Capa de agencia: el freno antes de encender el agente, y de dónde sale.
 *
 * En upstream, una instancia la configura su propio dueño: si enciende el
 * agente a medias, lo descubre él. Aquí el agente le contesta a los clientes
 * DEL NEGOCIO, así que encender no es un toggle: antes se lee de `/api/setup`
 * (la misma lista de bloqueos que aplica el servidor al encender) y se enseña
 * qué falta, o qué va a pasar si no falta nada.
 *
 * El freno CIERRA ante la duda: si esa lectura no llega (red caída, error del
 * servidor, respuesta rara), el estado es `error` y no hay botón de activar.
 * Antes dejaba pasar («una ayuda que no responde no puede bloquear»): justo el
 * caso en que no se sabe si falta algo era el que encendía el agente a ciegas.
 * Apagar nunca pasa por aquí: frenar al bot tiene que ser instantáneo.
 */

export type GateState =
  | { kind: "loading" }
  /** No se pudo saber qué falta: no se puede activar. */
  | { kind: "error" }
  /** Falta algo y el servidor no deja activar. */
  | { kind: "blocked"; activation: ActivationSummary }
  /** Se puede activar; `activation.blockers` son consejos si los hay (fuera del SaaS). */
  | { kind: "ready"; activation: ActivationSummary };

function isBlocker(value: unknown): boolean {
  const b = value as { code?: unknown; title?: unknown; detail?: unknown } | null;
  return Boolean(b && typeof b.code === "string" && typeof b.title === "string" && typeof b.detail === "string");
}

/** Convierte la respuesta de `/api/setup` en el estado del freno. Todo lo que no se entienda es `error`. */
export function gateStateFromResponse(payload: unknown): GateState {
  const activation = (payload as { activation?: ActivationSummary } | null)?.activation;
  if (
    !activation ||
    typeof activation.enforced !== "boolean" ||
    !Array.isArray(activation.blockers) ||
    !activation.blockers.every(isBlocker)
  ) {
    return { kind: "error" };
  }
  return activation.enforced && activation.blockers.length > 0
    ? { kind: "blocked", activation }
    : { kind: "ready", activation };
}

type SetupPayload = { progress?: SetupProgress; activation?: ActivationSummary };

/** Lee `/api/setup`: el avance de la puesta en marcha y el estado del freno. */
export function useSetup(initialProgress: SetupProgress | null = null) {
  const [progress, setProgress] = useState<SetupProgress | null>(initialProgress);
  const [gate, setGate] = useState<GateState>({ kind: "loading" });
  const latest = useRef(0);

  const reload = useCallback(async () => {
    const request = ++latest.current;
    const payload = (await fetch("/api/setup", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .catch(() => null)) as SetupPayload | null;
    // Una lectura vieja que llega tarde no pisa a la nueva.
    if (request !== latest.current) return;
    if (payload?.progress) setProgress(payload.progress);
    setGate(gateStateFromResponse(payload));
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const retry = useCallback(() => {
    setGate({ kind: "loading" });
    void reload();
  }, [reload]);

  return { progress, gate, reload, retry };
}

import type { ReadinessResponse, ReadinessStep } from "@/server/readiness";

/**
 * Los cuatro pasos de la puesta en marcha, con su nombre y su pantalla. Puro y
 * sin servidor: lo importan la UI (el registro anuncia los pasos que siguen) y
 * el cálculo (`server/agencia/setup-progress.ts`), así que el nombre de un paso
 * se escribe una sola vez. Crear la cuenta pasa antes y no es un paso.
 */

// Fork (agencia): primero lo que da valor sin depender de Meta. El dueño escribe
// su negocio y ve a su agente contestar en Probar ANTES de pelear con la
// ventana de Meta, que es donde más altas se caen (bloqueadores, navegador de
// Instagram). Conectar WhatsApp queda justo antes de encenderlo.
export const SETUP_STEP_ORDER = ["negocio", "probar", "whatsapp", "activar"] as const;
export type SetupStepKey = (typeof SETUP_STEP_ORDER)[number];

export const SETUP_STEP_META: Record<SetupStepKey, { label: string; href: string }> = {
  whatsapp: { label: "Conectar WhatsApp", href: "/settings/whatsapp" },
  negocio: { label: "Tu negocio", href: "/agent" },
  probar: { label: "Probar", href: "/lab" },
  activar: { label: "Activar", href: "/agent#activar" },
};

/**
 * UN solo modelo de avance para «poner a trabajar al agente».
 *
 * Antes había tres contadores que no coincidían («1 de 6» en el registro,
 * «paso 2 de 6» fijo en WhatsApp, 7 u 8 pasos en Inicio). Este sale de lo
 * mismo que ya sabe el servidor, la preparación (`getReadiness`), y se dibuja
 * igual en todas las pantallas de configuración. Crear la cuenta pasa antes y
 * no es un paso: quien llega aquí ya la tiene.
 *
 * Es puro sobre `ReadinessResponse` a propósito: Inicio puede llamarlo con la
 * preparación que ya cargó, sin otra consulta.
 */

export type SetupStep = {
  key: SetupStepKey;
  label: string;
  /** A dónde lleva el paso. */
  href: string;
  done: boolean;
};

export type SetupProgress = {
  steps: SetupStep[];
  /** El primer paso sin terminar; null cuando los cuatro están listos. */
  current: SetupStepKey | null;
  /**
   * La puesta en marcha sigue abierta: el agente todavía no está activo. Con
   * el agente activo ya no es una configuración sino mantenimiento, y las
   * pantallas no dibujan el avance (un dueño que vuelve ve su operación, no un
   * asistente de alta).
   */
  active: boolean;
};

function stepOf(readiness: ReadinessResponse, id: ReadinessStep["id"]): ReadinessStep | undefined {
  return readiness.steps.find((step) => step.id === id);
}

function complete(readiness: ReadinessResponse, id: ReadinessStep["id"]): boolean {
  return stepOf(readiness, id)?.status === "complete";
}

export function deriveSetupProgress(readiness: ReadinessResponse): SetupProgress {
  // «Tu negocio» es todo lo que el dueño escribe: el horario (solo existe en
  // SaaS, en otras instancias el paso no está y no cuenta), los datos del
  // agente y la información del negocio.
  const hoursStep = stepOf(readiness, "business_hours");
  const done: Record<SetupStepKey, boolean> = {
    whatsapp: complete(readiness, "whatsapp"),
    negocio:
      (!hoursStep || hoursStep.status === "complete") &&
      complete(readiness, "agent_profile") &&
      complete(readiness, "knowledge"),
    probar: complete(readiness, "simulation"),
    activar: readiness.agentEnabled,
  };
  const steps = SETUP_STEP_ORDER.map((key) => ({ key, ...SETUP_STEP_META[key], done: done[key] }));
  return {
    steps,
    current: steps.find((step) => !step.done)?.key ?? null,
    active: !done.activar,
  };
}


/** Lo que dice el botón que lleva al paso que toca. */
export const SETUP_STEP_CTA: Record<SetupStepKey, string> = {
  whatsapp: "Conectar WhatsApp",
  negocio: "Seguir: cuéntanos de tu negocio",
  probar: "Seguir: probar tu agente",
  activar: "Seguir: activar tu agente",
};

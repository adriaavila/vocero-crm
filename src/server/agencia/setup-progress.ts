import { SETUP_STEP_META, SETUP_STEP_ORDER, type SetupStepKey } from "@/lib/setup-steps";
import { getReadiness, type ReadinessResponse, type ReadinessStep } from "@/server/readiness";

export { SETUP_STEP_ORDER, type SetupStepKey };

/**
 * Capa de agencia: UN solo modelo de avance para «poner a trabajar al agente».
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

export async function getSetupProgress(
  organizationId: string,
  readiness?: ReadinessResponse,
): Promise<SetupProgress> {
  return deriveSetupProgress(readiness ?? (await getReadiness(organizationId)));
}

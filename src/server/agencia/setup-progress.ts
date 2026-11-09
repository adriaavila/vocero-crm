import {
  deriveSetupProgress,
  SETUP_STEP_ORDER,
  type SetupProgress,
  type SetupStep,
  type SetupStepKey,
} from "@/lib/setup-steps";
import { cache } from "react";
import { getReadiness, type ReadinessResponse } from "@/server/readiness";

// El modelo vive en `lib/setup-steps` (puro, sin servidor) para que Inicio y las
// pantallas de configuración lo dibujen igual; aquí solo se arma con la base.
export { deriveSetupProgress, SETUP_STEP_ORDER };
export type { SetupProgress, SetupStep, SetupStepKey };

// Una sola lectura por petición: el layout de Configuración, su página y la
// barra lateral piden lo mismo en el mismo render (`cache` de React lo comparte;
// fuera de un render de React no guarda nada y se comporta como una función).
const progressOf = cache(async (organizationId: string): Promise<SetupProgress> =>
  deriveSetupProgress(await getReadiness(organizationId)),
);

export async function getSetupProgress(
  organizationId: string,
  readiness?: ReadinessResponse,
): Promise<SetupProgress> {
  return readiness ? deriveSetupProgress(readiness) : progressOf(organizationId);
}

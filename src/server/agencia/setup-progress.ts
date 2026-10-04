import {
  deriveSetupProgress,
  SETUP_STEP_ORDER,
  type SetupProgress,
  type SetupStep,
  type SetupStepKey,
} from "@/lib/setup-steps";
import { getReadiness, type ReadinessResponse } from "@/server/readiness";

// El modelo vive en `lib/setup-steps` (puro, sin servidor) para que Inicio y las
// pantallas de configuración lo dibujen igual; aquí solo se arma con la base.
export { deriveSetupProgress, SETUP_STEP_ORDER };
export type { SetupProgress, SetupStep, SetupStepKey };

export async function getSetupProgress(
  organizationId: string,
  readiness?: ReadinessResponse,
): Promise<SetupProgress> {
  return deriveSetupProgress(readiness ?? (await getReadiness(organizationId)));
}

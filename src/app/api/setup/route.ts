import { withOwner } from "@/lib/api";
import { getActivationSummary } from "@/server/agencia/activacion";
import { getSetupProgress } from "@/server/agencia/setup-progress";
import { getReadiness } from "@/server/readiness";

export const dynamic = "force-dynamic";

/**
 * Capa de agencia: el avance de la puesta en marcha (los cuatro pasos) y lo
 * que muestra «Activar» (número, horario, qué hará el agente y qué falta). Una
 * sola lectura de la preparación para las dos cosas.
 */
export const GET = withOwner(async (session) => {
  const readiness = await getReadiness(session.organizationId);
  const [progress, activation] = await Promise.all([
    getSetupProgress(session.organizationId, readiness),
    getActivationSummary(session.organizationId, readiness),
  ]);
  return Response.json({ progress, activation });
});

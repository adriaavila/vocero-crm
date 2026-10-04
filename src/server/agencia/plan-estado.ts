import { derivePlanState, type PlanState } from "@/lib/plan-estado";
import { isAllokSaaSMode } from "@/lib/tenant-host";
import { trialAiRepliesUsed } from "@/server/agencia/entitlements";
import { getOrganizationBilling } from "@/server/saas/billing";

/**
 * Capa de agencia — el punto del plan de un negocio con datos reales (la
 * lectura de facturación y, en la prueba, cuántas respuestas de IA gastó). Las
 * reglas viven en `lib/plan-estado` (puras y probadas); acá solo se leen.
 *
 * Fuera del SaaS no hay planes: el agente siempre puede contestar.
 */
export async function getPlanState(organizationId: string): Promise<PlanState> {
  if (!isAllokSaaSMode()) {
    return {
      kind: "paid",
      agentAllowed: true,
      plan: null,
      endsAt: null,
      daysLeft: null,
      replies: null,
      hasSubscription: false,
    };
  }
  const billing = await getOrganizationBilling(organizationId);
  // El conteo solo hace falta en la prueba de autoservicio (y devuelve null fuera de ella).
  const replies = await trialAiRepliesUsed(organizationId);
  return derivePlanState(billing, replies);
}

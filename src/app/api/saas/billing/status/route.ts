import { withOwner } from "@/lib/api";
import { getOrganizationBilling } from "@/server/saas/billing";
import { getPlanState } from "@/server/agencia/plan-estado";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Lo mínimo que la pantalla necesita para saber si el pago ya se reflejó: al
 * volver de Stripe el webhook puede llegar unos segundos después que el
 * dueño, y esta lectura deja a la pantalla esperarlo sin recargar a ciegas.
 */
export const GET = withOwner(async (session) => {
  const [billing, plan] = await Promise.all([
    getOrganizationBilling(session.organizationId),
    getPlanState(session.organizationId),
  ]);
  return Response.json({
    kind: plan.kind,
    status: billing.status,
    plan: billing.plan,
    agentAllowed: plan.agentAllowed,
    hasSubscription: plan.hasSubscription,
    updatedAt: billing.updatedAt,
  });
});

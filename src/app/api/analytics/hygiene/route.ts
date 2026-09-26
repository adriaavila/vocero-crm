import { withProOwner } from "@/lib/api";
import { getBranding } from "@/server/branding";
import { hygieneBlock } from "@/server/analytics/hygiene";

export const dynamic = "force-dynamic";

/**
 * 019 — Higiene. Sin rango: describe el AHORA, no un periodo.
 *
 * Fork — solo el propietario, y en SaaS solo el plan Completo (`withProOwner`;
 * `hasSaaSPlan` es un no-op fuera de modo SaaS), igual que el resto de
 * Resultados.
 */
export const GET = withProOwner(async (session) => {
  const branding = await getBranding(session.organizationId);
  return Response.json(await hygieneBlock(session.organizationId, branding.currency));
});

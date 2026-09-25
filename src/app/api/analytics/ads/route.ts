import { apiError, withProOwner } from "@/lib/api";
import { PeriodError, periodFromRequest } from "@/server/analytics/period";
import { adsBlock } from "@/server/analytics/ads";

export const dynamic = "force-dynamic";

/**
 * 019 — De dónde llegan: conversaciones, prospectos y ventas por origen y por
 * anuncio. Solo conteos: sin gasto, sin costo, sin retorno (spec 019, D1-D2).
 *
 * Fork — solo el propietario, y en SaaS solo el plan Completo (`withProOwner`;
 * `hasSaaSPlan` es un no-op fuera de modo SaaS), igual que el resto de
 * Resultados.
 */
export const GET = withProOwner(async (session, req: Request) => {
  try {
    const period = await periodFromRequest(session.organizationId, new URL(req.url));
    return Response.json(await adsBlock(session.organizationId, period));
  } catch (err) {
    if (err instanceof PeriodError) {
      return apiError(422, "invalid_period", err.message);
    }
    throw err;
  }
});

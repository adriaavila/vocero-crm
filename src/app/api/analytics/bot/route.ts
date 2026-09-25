import { apiError, withProOwner } from "@/lib/api";
import { PeriodError, periodFromRequest } from "@/server/analytics/period";
import { botBlock } from "@/server/analytics/bot";

export const dynamic = "force-dynamic";

/**
 * 019 — El trabajo del agente. Las citas, solo con la bandera AGENDA.
 *
 * Fork — solo el propietario, y en SaaS solo el plan Completo (`withProOwner`;
 * `hasSaaSPlan` es un no-op fuera de modo SaaS), igual que el resto de
 * Resultados.
 */
export const GET = withProOwner(async (session, req: Request) => {
  try {
    const period = await periodFromRequest(session.organizationId, new URL(req.url));
    return Response.json(await botBlock(session.organizationId, period));
  } catch (err) {
    if (err instanceof PeriodError) {
      return apiError(422, "invalid_period", err.message);
    }
    throw err;
  }
});

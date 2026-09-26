import { apiError, withProOwner } from "@/lib/api";
import { getBranding } from "@/server/branding";
import { PeriodError, periodFromRequest } from "@/server/analytics/period";
import { salesBlock } from "@/server/analytics/sales";

export const dynamic = "force-dynamic";

/**
 * 019 — Ventas y embudo del periodo (`?from=AAAA-MM-DD&to=AAAA-MM-DD`).
 *
 * Fork — solo el propietario, y en SaaS solo el plan Completo (`withProOwner`;
 * `hasSaaSPlan` es un no-op fuera de modo SaaS), igual que el resto de
 * Resultados.
 */
export const GET = withProOwner(async (session, req: Request) => {
  try {
    const [period, branding] = await Promise.all([
      periodFromRequest(session.organizationId, new URL(req.url)),
      getBranding(session.organizationId),
    ]);
    return Response.json(
      await salesBlock(session.organizationId, period, branding.currency)
    );
  } catch (err) {
    if (err instanceof PeriodError) {
      return apiError(422, "invalid_period", err.message);
    }
    throw err;
  }
});

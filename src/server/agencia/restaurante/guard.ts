import { apiError, withAuth } from "@/lib/api";
import type { SessionContext } from "@/lib/auth/session";
import { hasSaaSPlan } from "@/server/agencia/entitlements";
import { isRestauranteOrg } from "@/server/agencia/vertical";

/**
 * Guardia de `/api/restaurante/*`, igual que `withRealty`: sin el vertical la
 * superficie no existe (404); con el vertical pero sin plan Completo, 403.
 */
export function withRestaurante<Args extends unknown[]>(
  handler: (session: SessionContext, ...args: Args) => Promise<Response>
): (...args: Args) => Promise<Response> {
  return withAuth(async (session, ...args) => {
    if (!(await isRestauranteOrg(session.organizationId))) {
      return apiError(404, "vertical_disabled", "Este negocio no tiene menú y pedidos activos");
    }
    if (!(await hasSaaSPlan(session.organizationId, "pro"))) {
      return apiError(403, "plan_required", "Esta función está disponible en el plan Completo");
    }
    return handler(session, ...args);
  });
}

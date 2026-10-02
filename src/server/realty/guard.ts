import { apiError, withAuth } from "@/lib/api";
import type { SessionContext } from "@/lib/auth/session";
import { hasSaaSPlan } from "@/server/agencia/entitlements";
import { isRealtyOrg } from "@/server/agencia/vertical";

/**
 * Guardia de las rutas `/api/properties/*`: compone el flag de vertical con
 * el gate de plan, en ese orden.
 *
 * 1. Sin el vertical activo, la ruta responde 404 `vertical_disabled` — igual
 *    que un canal apagado (ADR-001): para esta organización, esta superficie
 *    NO EXISTE, y un 403 filtraría que sí existe pero está bloqueada.
 * 2. Con el vertical activo pero sin plan Completo, 403 `plan_required` —
 *    mismo criterio que Resultados/Agenda/Equipo (`withPro` en `lib/api.ts`).
 *    En una instancia sin `ALLOK_SAAS_MODE` (Rei, autoprovisionado por su
 *    propio negocio) `hasSaaSPlan` siempre da `true`: el gate solo actúa
 *    quien vende el vertical DENTRO de allok con su propio plan de pago.
 */
export function withRealty<Args extends unknown[]>(
  handler: (session: SessionContext, ...args: Args) => Promise<Response>
): (...args: Args) => Promise<Response> {
  return withAuth(async (session, ...args) => {
    if (!(await isRealtyOrg(session.organizationId))) {
      return apiError(
        404,
        "vertical_disabled",
        "Esta instancia no tiene el vertical inmobiliario activo"
      );
    }
    if (!(await hasSaaSPlan(session.organizationId, "pro"))) {
      return apiError(
        403,
        "plan_required",
        "Esta función está disponible en el plan Completo"
      );
    }
    return handler(session, ...args);
  });
}

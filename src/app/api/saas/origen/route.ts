import { apiError, withOwner } from "@/lib/api";
import { isAllokSaaSMode } from "@/lib/tenant-host";
import { guardarOrigen, parseOrigen } from "@/server/agencia/origen-alta";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Capa de agencia — el registro manda de dónde llegó el alta justo después de
 * crear la cuenta. Es de mejor esfuerzo: lo que no se entiende se ignora, y
 * nunca hace esperar ni falla el alta (el formulario corta a los 2,5 s).
 * Solo el dueño, solo en el SaaS, y el primer toque gana (`guardarOrigen`).
 */
export const POST = withOwner<[Request]>(async (session, request: Request) => {
  if (!isAllokSaaSMode()) return apiError(404, "not_found", "No disponible");
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, "invalid_body", "El body debe ser JSON válido");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return apiError(400, "invalid_body", "El body debe ser un objeto");
  }
  const origen = parseOrigen(body);
  if (origen) {
    try {
      await guardarOrigen(session.organizationId, origen);
    } catch (err) {
      // El rastreo no es el alta: se anota y se sigue.
      console.error("[saas/origen] no se pudo guardar el origen:", err);
    }
  }
  return new Response(null, { status: 204 });
}, { allowSaaSAppHost: true });

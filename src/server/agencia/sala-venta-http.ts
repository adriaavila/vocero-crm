import { apiError } from "@/lib/api";
import type { SessionContext } from "@/lib/auth/session";
import { withRealty } from "@/server/realty/guard";
import { SalaError, salaVentaEnabled } from "@/server/agencia/sala-venta";

/**
 * Guardia de `/api/salas/*`: la bandera de despliegue ANTES que la sesión
 * (apagada, la superficie no existe: 404), luego el vertical y el plan.
 */
export function withSala<Args extends unknown[]>(
  handler: (session: SessionContext, ...args: Args) => Promise<Response>
): (...args: Args) => Promise<Response> {
  const conRealty = withRealty(handler);
  return async (...args: Args) => {
    if (!salaVentaEnabled()) return new Response(null, { status: 404 });
    return conRealty(...args);
  };
}

export function salaErrorResponse(err: unknown): Response {
  if (err instanceof SalaError) {
    const status = err.code === "no_encontrado" ? 404 : 422;
    return apiError(status, err.code, err.message);
  }
  throw err;
}

/** La URL del link con el host por el que entró el dueño (santorini.reiprop.tech). */
export function baseUrlDe(req: Request): string {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!host) return process.env.APP_BASE_URL ?? "";
  const proto = req.headers.get("x-forwarded-proto") ?? new URL(req.url).protocol.replace(":", "");
  return `${proto}://${host}`;
}

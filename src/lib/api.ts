import { z } from "zod";
import {
  requireSession,
  SaaSMemberPlanRequiredError,
  TenantNotFoundError,
  UnauthorizedError,
  type SessionContext,
  type SessionOptions,
} from "@/lib/auth/session";
import { hasSaaSPlan } from "@/server/agencia/entitlements";

/** Respuesta de error estándar de la API interna (contrato api.md). */
export function apiError(
  status: number,
  code: string,
  message: string
): Response {
  return Response.json({ error: { code, message } }, { status });
}

/**
 * Envuelve un route handler autenticado: resuelve la sesión (401 si no hay),
 * captura errores no controlados (500 sin stack) y deja pasar Response.
 */
export function withAuth<Args extends unknown[]>(
  handler: (session: SessionContext, ...args: Args) => Promise<Response>,
  options: SessionOptions = {},
): (...args: Args) => Promise<Response> {
  return async (...args: Args) => {
    let session: SessionContext;
    try {
      session = await requireSession(options);
    } catch (err) {
      if (err instanceof TenantNotFoundError || (typeof err === "object" && err !== null && "name" in err && err.name === "TenantNotFoundError")) {
        return apiError(404, "tenant_not_found", "El negocio no existe");
      }
      if (err instanceof SaaSMemberPlanRequiredError) {
        return apiError(402, "plan_required", "El acceso de miembros está pausado hasta reactivar Pro");
      }
      if (err instanceof UnauthorizedError) {
        return apiError(401, "unauthorized", "No autenticado");
      }
      throw err;
    }
    try {
      return await handler(session, ...args);
    } catch (err) {
      console.error("[api] error no controlado:", err);
      return apiError(500, "internal", "Error interno");
    }
  };
}

/** Igual que withAuth, pero restringe la superficie al propietario. */
export function withOwner<Args extends unknown[]>(
  handler: (session: SessionContext, ...args: Args) => Promise<Response>,
  options: SessionOptions = {},
): (...args: Args) => Promise<Response> {
  return withAuth(async (session, ...args) => {
    if (session.role !== "owner") {
      return apiError(403, "forbidden", "Solo el propietario puede realizar esta acción");
    }
    return handler(session, ...args);
  }, options);
}

export function withPro<Args extends unknown[]>(
  handler: (session: SessionContext, ...args: Args) => Promise<Response>
): (...args: Args) => Promise<Response> {
  return withAuth(async (session, ...args) => {
    if (!(await hasSaaSPlan(session.organizationId, "pro"))) {
      return apiError(403, "plan_required", "Esta función está disponible en el plan Pro");
    }
    return handler(session, ...args);
  });
}

export function withProOwner<Args extends unknown[]>(
  handler: (session: SessionContext, ...args: Args) => Promise<Response>
): (...args: Args) => Promise<Response> {
  return withAuth(async (session, ...args) => {
    if (session.role !== "owner") {
      return apiError(403, "forbidden", "Solo el propietario puede realizar esta acción");
    }
    if (!(await hasSaaSPlan(session.organizationId, "pro"))) {
      return apiError(403, "plan_required", "Esta función está disponible en el plan Pro");
    }
    return handler(session, ...args);
  });
}

/** Parsea el body JSON con un esquema Zod; inválido → Response 422. */
export async function parseBody<T>(
  req: Request,
  schema: z.ZodType<T>
): Promise<{ ok: true; data: T } | { ok: false; response: Response }> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return {
      ok: false,
      response: apiError(422, "invalid_body", "El body debe ser JSON válido"),
    };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `${i.path.join(".") || "body"}: ${i.message}`)
      .join("; ");
    return {
      ok: false,
      response: apiError(422, "invalid_body", detail),
    };
  }
  return { ok: true, data: parsed.data };
}

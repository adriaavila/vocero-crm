import { eq } from "drizzle-orm";
import { z } from "zod";
import { apiError, parseBody, withOwner } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { isAllokSaaSMode } from "@/lib/tenant-host";
import { canjearCupon, hayCupones, MENSAJE_CANJE } from "@/server/agencia/cupones";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ codigo: z.string().trim().min(1).max(60) });

/**
 * `POST /api/saas/billing/cupon`: el dueño canjea un código de plan gratis
 * (`server/agencia/cupones.ts`). Lo llama el registro de autoservicio justo
 * después de crear la cuenta, y Facturación cuando el negocio ya existía.
 */
export const POST = withOwner<[Request]>(async (session, request: Request) => {
  if (!isAllokSaaSMode() || !hayCupones()) return apiError(404, "not_found", "No encontrado.");
  // Un código se adivina probando: diez intentos por hora y negocio.
  const limit = checkRateLimit(`cupon:${session.organizationId}`, { windowMs: 60 * 60 * 1000, max: 10 });
  if (!limit.allowed) return apiError(429, "rate_limited", "Demasiados intentos. Prueba de nuevo en un rato.");
  const parsed = await parseBody(request, bodySchema);
  if (!parsed.ok) return parsed.response;
  const user = (await getDb()
    .select({ email: schema.user.email })
    .from(schema.user)
    .where(eq(schema.user.id, session.userId))
    .limit(1))[0];
  if (!user) return apiError(401, "unauthorized", "No autenticado.");
  const result = await canjearCupon({
    organizationId: session.organizationId,
    codigo: parsed.data.codigo,
    userId: session.userId,
    email: user.email,
  });
  if (!result.ok) return apiError(result.reason === "plan_activo" ? 409 : 422, result.reason, MENSAJE_CANJE[result.reason]);
  return Response.json({ plan: result.plan });
}, { allowSaaSAppHost: true });

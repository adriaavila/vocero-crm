import { z } from "zod";
import { grantSaaSPlan, requireSaaSAdminIdentity, revokeSaaSPlan, SaaSAdminUnauthorized } from "@/server/saas/admin";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// El admin puede conceder cualquier plan del catálogo, sin importar
// SAAS_PLANS (eso solo gobierna qué vende el checkout/registro público).
const grantSchema = z.object({
  plan: z.enum(["basic", "pro", "inmobiliaria"]),
  confirmOverrideStripe: z.boolean().optional(),
}).strict();

const revokeSchema = z.object({
  confirmOverrideStripe: z.boolean().optional(),
}).strict();

function jsonError(status: number, message: string): Response {
  return Response.json({ message }, { status });
}

function hasJsonContentType(req: Request): boolean {
  return (req.headers.get("content-type") ?? "").toLowerCase().includes("application/json");
}

/**
 * Alta/baja manual de plan desde el panel admin: el respaldo de "paga por
 * link o transferencia" a lo que hoy se hace con SQL a mano en producción
 * (specs/018). Nunca del lado del cliente: solo `requireSaaSAdminIdentity`
 * (host admin + email autorizado) puede llegar aquí. La auditoría se
 * escribe dentro de `grantSaaSPlan`/`revokeSaaSPlan`, después de saber si el
 * negocio existe y cuál fue el resultado — no aquí.
 */
export async function POST(req: Request, ctx: Params): Promise<Response> {
  const { id } = await ctx.params;
  let admin;
  try {
    admin = await requireSaaSAdminIdentity();
  } catch (error) {
    if (error instanceof SaaSAdminUnauthorized) return jsonError(404, "No encontrado");
    throw error;
  }

  if (!hasJsonContentType(req)) return jsonError(415, "Content-Type debe ser application/json.");
  const body = (await req.json().catch(() => null)) as unknown;
  const parsed = grantSchema.safeParse(body);
  if (!parsed.success) return jsonError(422, "Plan inválido.");

  const result = await grantSaaSPlan({
    organizationId: id,
    plan: parsed.data.plan,
    adminEmail: admin.email,
    adminUserId: admin.userId,
    confirmOverrideStripe: parsed.data.confirmOverrideStripe === true,
  });
  if (!result.ok) {
    return result.reason === "not_found"
      ? jsonError(404, "Negocio no encontrado.")
      : jsonError(409, "Este negocio ya tiene una suscripción de Stripe vigente. Confirma para reemplazarla igual.");
  }
  return Response.json({ billing: result.billing });
}

export async function DELETE(req: Request, ctx: Params): Promise<Response> {
  const { id } = await ctx.params;
  let admin;
  try {
    admin = await requireSaaSAdminIdentity();
  } catch (error) {
    if (error instanceof SaaSAdminUnauthorized) return jsonError(404, "No encontrado");
    throw error;
  }

  if (!hasJsonContentType(req)) return jsonError(415, "Content-Type debe ser application/json.");
  const body = (await req.json().catch(() => null)) as unknown;
  const parsed = revokeSchema.safeParse(body ?? {});
  if (!parsed.success) return jsonError(422, "Solicitud inválida.");

  const result = await revokeSaaSPlan({
    organizationId: id,
    adminEmail: admin.email,
    adminUserId: admin.userId,
    confirmOverrideStripe: parsed.data.confirmOverrideStripe === true,
  });
  if (!result.ok) {
    return result.reason === "not_found"
      ? jsonError(404, "Negocio no encontrado.")
      : jsonError(409, "Este negocio ya tiene una suscripción de Stripe vigente. Confirma para quitarlo igual.");
  }
  return Response.json({ billing: result.billing });
}

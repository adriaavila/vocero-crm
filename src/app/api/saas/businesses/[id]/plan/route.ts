import { z } from "zod";
import { soldSaaSPlans } from "@/lib/saas-plans";
import { grantSaaSPlan, requireSaaSAdmin, revokeSaaSPlan, SaaSAdminUnauthorized } from "@/server/saas/admin";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const grantSchema = z.object({
  plan: z.enum(["basic", "pro", "inmobiliaria"]),
  confirmOverrideStripe: z.boolean().optional(),
});

const revokeSchema = z.object({
  confirmOverrideStripe: z.boolean().optional(),
});

function jsonError(status: number, message: string): Response {
  return Response.json({ message }, { status });
}

/**
 * Alta/baja manual de plan desde el panel admin: el respaldo de "paga por
 * link o transferencia" a lo que hoy se hace con SQL a mano en producción
 * (specs/018). Nunca del lado del cliente: solo `requireSaaSAdmin` (host
 * admin + email autorizado) puede llegar aquí, y cada llamada queda
 * auditada con la organización afectada.
 */
export async function POST(req: Request, ctx: Params): Promise<Response> {
  const { id } = await ctx.params;
  let admin;
  try {
    admin = await requireSaaSAdmin("grant_plan", id);
  } catch (error) {
    if (error instanceof SaaSAdminUnauthorized) return jsonError(404, "No encontrado");
    throw error;
  }

  const body = (await req.json().catch(() => null)) as unknown;
  const parsed = grantSchema.safeParse(body);
  if (!parsed.success) return jsonError(422, "Plan inválido.");
  if (!soldSaaSPlans(process.env.SAAS_PLANS).includes(parsed.data.plan)) {
    return jsonError(422, "Este despliegue no vende ese plan (revisa SAAS_PLANS).");
  }

  const result = await grantSaaSPlan({
    organizationId: id,
    plan: parsed.data.plan,
    adminEmail: admin.email,
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
  try {
    await requireSaaSAdmin("revoke_plan", id);
  } catch (error) {
    if (error instanceof SaaSAdminUnauthorized) return jsonError(404, "No encontrado");
    throw error;
  }

  const body = (await req.json().catch(() => null)) as unknown;
  const parsed = revokeSchema.safeParse(body ?? {});
  if (!parsed.success) return jsonError(422, "Solicitud inválida.");

  const result = await revokeSaaSPlan({
    organizationId: id,
    confirmOverrideStripe: parsed.data.confirmOverrideStripe === true,
  });
  if (!result.ok) {
    return result.reason === "not_found"
      ? jsonError(404, "Negocio no encontrado.")
      : jsonError(409, "Este negocio ya tiene una suscripción de Stripe vigente. Confirma para quitarlo igual.");
  }
  return Response.json({ billing: result.billing });
}

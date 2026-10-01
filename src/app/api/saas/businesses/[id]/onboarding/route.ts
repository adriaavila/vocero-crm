import { z } from "zod";
import { auditSaaSAdminAction, requireSaaSAdminIdentity, SaaSAdminUnauthorized } from "@/server/saas/admin";
import { retryActivation } from "@/server/onboarding/status";
import { resetOnboarding } from "@/server/onboarding/whatsapp-onboarding";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const bodySchema = z.object({ action: z.enum(["retry", "reset"]) }).strict();

/**
 * Soporte del alta de WhatsApp desde el panel admin (allok.fun/ops deja de ser
 * el camino de alta): `retry` termina de activar un número ya guardado con su
 * token; `reset` devuelve el alta a "pendiente" para que el dueño vuelva a
 * conectar. Ninguno borra credenciales. Todo queda auditado.
 */
export async function POST(req: Request, ctx: Params): Promise<Response> {
  const { id } = await ctx.params;
  let admin;
  try {
    admin = await requireSaaSAdminIdentity();
  } catch (error) {
    if (error instanceof SaaSAdminUnauthorized) return Response.json({ message: "No encontrado" }, { status: 404 });
    throw error;
  }
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ message: "Acción inválida." }, { status: 422 });

  const action = parsed.data.action;
  let outcome: string;
  if (action === "retry") {
    const result = await retryActivation(id);
    outcome = result.ok ? "ok" : result.step;
  } else {
    await resetOnboarding(id);
    outcome = "ok";
  }
  await auditSaaSAdminAction({
    userId: admin.userId,
    action: `onboarding_${action}`,
    organizationId: id,
    detail: { outcome },
  });
  return Response.json({ ok: outcome === "ok", outcome });
}

import { z } from "zod";
import { auditSaaSAdminAction, requireSaaSAdminIdentity, SaaSAdminUnauthorized } from "@/server/saas/admin";
import { crearEnlaceContrasena, EnlaceContrasenaError } from "@/server/agencia/enlace-contrasena";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const bodySchema = z.object({ email: z.string().trim().email().max(320).optional() }).strict();

const NO_STORE = { "cache-control": "no-store" };

/**
 * Fork (agencia): enlace de un solo uso para que un usuario de un negocio
 * elija una contraseña nueva, para pasárselo por WhatsApp cuando el correo no
 * llega. Solo admins del SaaS; queda en la bitácora del admin (sin el token).
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
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ message: "Correo inválido." }, { status: 422 });

  try {
    const link = await crearEnlaceContrasena({ organizationId: id, email: parsed.data.email });
    await auditSaaSAdminAction({
      userId: admin.userId,
      action: "password_link",
      organizationId: id,
      detail: { targetUserId: link.userId, expiresAt: link.expiresAt },
    });
    return Response.json({ url: link.url, email: link.email, expiresAt: link.expiresAt }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof EnlaceContrasenaError) {
      const message = error.code === "negocio_no_encontrado" ? "Negocio no encontrado." : "Ese correo no es de un usuario de este negocio.";
      return Response.json({ message }, { status: 404 });
    }
    throw error;
  }
}

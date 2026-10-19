import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { auditSaaSAdminAction, requireSaaSAdminIdentity, SaaSAdminUnauthorized } from "@/server/saas/admin";
import { clearOrgVertical, setOrgVertical } from "@/server/agencia/vertical";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const bodySchema = z.object({ vertical: z.enum(["inmobiliario"]).nullable() }).strict();

/**
 * Fork (agencia): enciende o apaga el módulo vertical de un negocio desde el
 * panel admin. En allok los negocios nacen sin vertical (no hay
 * `DEFAULT_VERTICAL`), así que una constructora que vende casas no tenía
 * cómo llegar a su catálogo de propiedades. Apagarlo no borra propiedades.
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
  if (!parsed.success) return Response.json({ message: "Vertical inválido." }, { status: 422 });

  const rows = await getDb()
    .select({ id: schema.organization.id })
    .from(schema.organization)
    .where(eq(schema.organization.id, id))
    .limit(1);
  if (!rows[0]) return Response.json({ message: "Negocio no encontrado." }, { status: 404 });

  const vertical = parsed.data.vertical;
  if (vertical) await setOrgVertical(id, vertical);
  else await clearOrgVertical(id);
  await auditSaaSAdminAction({
    userId: admin.userId,
    action: vertical ? "vertical_on" : "vertical_off",
    organizationId: id,
    detail: { vertical },
  });
  return Response.json({ vertical });
}

import { apiError, parseBody } from "@/lib/api";
import { ProductoCambioSchema } from "@/server/agencia/restaurante/esquemas";
import { withRestaurante } from "@/server/agencia/restaurante/guard";
import { cambiarProducto, crearCategoria, leerMenu } from "@/server/agencia/restaurante/menu";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export const PATCH = withRestaurante(async (session, req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const parsed = await parseBody(req, ProductoCambioSchema);
  if (!parsed.ok) return parsed.response;
  const { category, ...cambio } = parsed.data;
  if (category) cambio.categoryId = await crearCategoria(session.organizationId, category);
  const ok = await cambiarProducto(session.organizationId, id, cambio);
  // Un producto de otro negocio responde 404: ni su existencia se filtra.
  if (!ok) return apiError(404, "not_found", "Producto no encontrado");
  return Response.json({ menu: await leerMenu(session.organizationId) });
});

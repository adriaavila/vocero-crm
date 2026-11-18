import { parseBody } from "@/lib/api";
import { ProductoNuevo } from "@/server/agencia/restaurante/esquemas";
import { withRestaurante } from "@/server/agencia/restaurante/guard";
import { crearCategoria, crearProducto, leerMenu } from "@/server/agencia/restaurante/menu";

export const dynamic = "force-dynamic";

export const GET = withRestaurante(async (session) => {
  return Response.json({ menu: await leerMenu(session.organizationId) });
});

export const POST = withRestaurante(async (session, req: Request) => {
  const parsed = await parseBody(req, ProductoNuevo);
  if (!parsed.ok) return parsed.response;
  const { category, ...producto } = parsed.data;
  const categoryId = category
    ? await crearCategoria(session.organizationId, category)
    : producto.categoryId;
  const id = await crearProducto(session.organizationId, { ...producto, categoryId });
  return Response.json({ id, menu: await leerMenu(session.organizationId) }, { status: 201 });
});

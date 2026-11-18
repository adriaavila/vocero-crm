import { apiError, parseBody } from "@/lib/api";
import { PedidoCambio } from "@/server/agencia/restaurante/esquemas";
import { withRestaurante } from "@/server/agencia/restaurante/guard";
import { editarPedido, leerPedido } from "@/server/agencia/restaurante/pedidos";
import { respuestaDeFallo } from "@/server/agencia/restaurante/respuestas";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export const GET = withRestaurante(async (session, _req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const pedido = await leerPedido(session.organizationId, id);
  if (!pedido) return apiError(404, "not_found", "Pedido no encontrado");
  return Response.json({ pedido });
});

export const PATCH = withRestaurante(async (session, req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const parsed = await parseBody(req, PedidoCambio);
  if (!parsed.ok) return parsed.response;
  const r = await editarPedido(session.organizationId, id, parsed.data);
  if (!r.ok) return respuestaDeFallo(r);
  return Response.json({ pedido: r.pedido });
});

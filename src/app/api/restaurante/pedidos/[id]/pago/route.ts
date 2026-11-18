import { apiError, parseBody } from "@/lib/api";
import { PagoCambio } from "@/server/agencia/restaurante/esquemas";
import { withRestaurante } from "@/server/agencia/restaurante/guard";
import { registrarPago } from "@/server/agencia/restaurante/pedidos";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** Registra que el local ya cobró (QR, efectivo). allok no cobra. */
export const POST = withRestaurante(async (session, req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const parsed = await parseBody(req, PagoCambio);
  if (!parsed.ok) return parsed.response;
  const pedido = await registrarPago(session.organizationId, id, parsed.data);
  if (!pedido) return apiError(404, "not_found", "Pedido no encontrado");
  return Response.json({ pedido });
});

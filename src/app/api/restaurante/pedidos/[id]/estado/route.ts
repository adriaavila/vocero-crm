import { parseBody } from "@/lib/api";
import { EstadoCambio } from "@/server/agencia/restaurante/esquemas";
import { withRestaurante } from "@/server/agencia/restaurante/guard";
import { cambiarEstado } from "@/server/agencia/restaurante/pedidos";
import { respuestaDeFallo } from "@/server/agencia/restaurante/respuestas";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * Una PERSONA mueve el pedido (confirmar, listo, salió, entregado, cancelar).
 * El agente no tiene esta ruta: exige sesión.
 */
export const POST = withRestaurante(async (session, req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const parsed = await parseBody(req, EstadoCambio);
  if (!parsed.ok) return parsed.response;
  const r = await cambiarEstado(session.organizationId, id, parsed.data.hacia, session.userId);
  if (!r.ok) return respuestaDeFallo(r);
  return Response.json({ pedido: r.pedido, avisado: r.avisado });
});

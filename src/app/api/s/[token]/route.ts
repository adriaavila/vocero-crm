import { apiError, parseBody } from "@/lib/api";
import { SenalSchema, registrarSenal, salaVentaEnabled } from "@/server/agencia/sala-venta";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ token: string }> };

/**
 * Pública, sin sesión: la página de la sala avisa lo que hizo el comprador
 * (abrir, usar la calculadora, pedir visita). Lo manda el navegador, así la
 * vista previa del link que arma WhatsApp no cuenta como apertura.
 */
export async function POST(req: Request, ctx: Params) {
  if (!salaVentaEnabled()) return new Response(null, { status: 404 });
  const { token } = await ctx.params;
  const parsed = await parseBody(req, SenalSchema);
  if (!parsed.ok) return parsed.response;
  const ok = await registrarSenal(token, parsed.data.tipo);
  if (!ok) return apiError(404, "not_found", "Sala no encontrada");
  return new Response(null, { status: 204 });
}

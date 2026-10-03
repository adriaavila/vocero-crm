import { apiError, parseBody, withOwner } from "@/lib/api";
import { setVerdict, VerdictInput } from "@/server/agencia/decisions-read";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * Data spine — califica una decisión del agente: `{ verdict: "bien" | "fallo" |
 * null, note?: string (≤500) }`. `null` borra el veredicto. Queda quién y
 * cuándo. SOLO el propietario califica (el veredicto orienta cómo se corrige el
 * agente); leer las decisiones sigue abierto a los miembros. Una decisión de
 * otra organización es un 404.
 */
export const PATCH = withOwner(async (session, req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const body = await parseBody(req, VerdictInput);
  if (!body.ok) return body.response;

  const result = await setVerdict(session.organizationId, session.userId, id, body.data);
  if (!result) return apiError(404, "not_found", "Decisión no encontrada");
  return Response.json({ decision: result });
});

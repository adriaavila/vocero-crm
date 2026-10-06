import { z } from "zod";
import { apiError, parseBody, withOwner } from "@/lib/api";
import { BORRADOR_INPUT_MAX } from "@/server/agencia/borrador-negocio-prompt";
import { draftNegocio } from "@/server/agencia/borrador-negocio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ fuente: z.string().trim().min(3).max(BORRADOR_INPUT_MAX) }).strict();

/**
 * Fork (agencia): «Llénalo por mí» en «Tu negocio». Devuelve un BORRADOR de
 * los campos a partir del texto o la web del dueño; no guarda nada.
 */
export const POST = withOwner<[Request]>(async (session, req: Request) => {
  const body = await parseBody(req, Body);
  if (!body.ok) return body.response;
  const result = await draftNegocio(session.organizationId, body.data.fuente);
  if (!result.ok) return apiError(result.status, result.code, result.message);
  return Response.json({ borrador: result.borrador, remaining: result.remaining });
});

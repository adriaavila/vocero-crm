import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { askCentro } from "@/server/agencia/centro-ask";
import { ASK_QUESTION_MAX } from "@/server/agencia/centro-ask-prompt";

export const dynamic = "force-dynamic";

const Body = z.object({ question: z.string().trim().min(2).max(ASK_QUESTION_MAX) }).strict();

/**
 * «Pregúntale a allok» (Inicio): `{ question }` → `{ answer, remaining }`. La
 * pregunta se contesta con un resumen de la organización de la SESIÓN (nunca
 * una que venga en el body), 20 por día y organización. No se loguea ni la
 * pregunta ni la respuesta.
 */
export const POST = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, Body);
  if (!body.ok) return body.response;

  const result = await askCentro(session.organizationId, body.data.question);
  if (!result.ok) return apiError(result.status, result.code, result.message);
  return Response.json({ answer: result.answer, remaining: result.remaining });
});

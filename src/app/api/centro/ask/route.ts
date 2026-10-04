import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { answerChip, askCentro, CHIP_KINDS } from "@/server/agencia/centro-ask";
import { ASK_QUESTION_MAX } from "@/server/agencia/centro-ask-prompt";

export const dynamic = "force-dynamic";

const Body = z.union([
  z.object({ question: z.string().trim().min(2).max(ASK_QUESTION_MAX) }).strict(),
  z.object({ chip: z.enum(CHIP_KINDS) }).strict(),
]);

/**
 * «Pregúntale a allok» (Inicio). Dos formas:
 * - `{ chip }`: una de las tres preguntas sugeridas. Se contesta en el servidor
 *   con los datos, SIN modelo y sin gastar cupo.
 * - `{ question }`: texto libre, contestado por el modelo con un resumen de la
 *   organización de la SESIÓN (nunca una que venga en el body), 20 por día del
 *   negocio. No se loguea ni la pregunta ni la respuesta.
 */
export const POST = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, Body);
  if (!body.ok) return body.response;

  if ("chip" in body.data) {
    const answer = await answerChip(session.organizationId, body.data.chip);
    return Response.json({ answer, remaining: null, source: "datos" });
  }
  const result = await askCentro(session.organizationId, body.data.question);
  if (!result.ok) return apiError(result.status, result.code, result.message);
  return Response.json({ answer: result.answer, remaining: result.remaining, source: result.source });
});

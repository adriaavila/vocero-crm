import { apiError, withAuth } from "@/lib/api";
import { DecisionsQuery, listConversationDecisions } from "@/server/agencia/decisions-read";
import { getConversation } from "@/server/inbox/queries";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const ConversationDecisionsQuery = DecisionsQuery.pick({ limit: true, cursor: true });

/** Data spine — las decisiones del agente en UNA conversación, las más nuevas primero. */
export const GET = withAuth(async (session, req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const row = await getConversation(session.organizationId, id);
  if (!row) return apiError(404, "not_found", "Conversación no encontrada");

  const parsed = ConversationDecisionsQuery.safeParse(
    Object.fromEntries(new URL(req.url).searchParams)
  );
  if (!parsed.success) return apiError(422, "invalid_query", "Parámetros inválidos");

  const page = await listConversationDecisions(session.organizationId, id, parsed.data);
  if (page === "invalid_cursor") return apiError(422, "invalid_cursor", "Cursor inválido");
  return Response.json(page);
});

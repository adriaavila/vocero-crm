import { apiError, withAuth } from "@/lib/api";
import { DecisionsQuery, listDecisions } from "@/server/agencia/decisions-read";

export const dynamic = "force-dynamic";

/**
 * Data spine — decisiones del agente de la organización, las más nuevas
 * primero: qué hizo, con qué modelo y prompt, y un preview de a qué respondió y
 * qué contestó. `verdict=bien|fallo|none` filtra (none = sin calificar);
 * `cursor` es el `nextCursor` de la página anterior.
 */
export const GET = withAuth(async (session, req: Request) => {
  const parsed = DecisionsQuery.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!parsed.success) return apiError(422, "invalid_query", "Parámetros inválidos");

  const page = await listDecisions(session.organizationId, parsed.data);
  if (page === "invalid_cursor") return apiError(422, "invalid_cursor", "Cursor inválido");
  return Response.json(page);
});

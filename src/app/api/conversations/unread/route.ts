import { eq, sql } from "drizzle-orm";
import { withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";

export const dynamic = "force-dynamic";

/**
 * Total de no leídos para el contador del menú. Antes el menú pedía la lista
 * COMPLETA de conversaciones (con vista previa, etapa y anuncio de cada una)
 * solo para sumar un número, y lo hacía en cada mensaje y en cada pestaña.
 */
export const GET = withAuth(async (session) => {
  const [row] = await getDb()
    .select({ unread: sql<number>`coalesce(sum(${schema.conversation.unreadCount}), 0)::int` })
    .from(schema.conversation)
    .where(
      scoped(
        schema.conversation.organizationId,
        session.organizationId,
        eq(schema.conversation.isTest, false)
      )
    );
  return Response.json({ unread: row?.unread ?? 0 });
});

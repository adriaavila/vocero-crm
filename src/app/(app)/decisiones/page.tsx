import { redirect } from "next/navigation";
import { inArray } from "drizzle-orm";
import { requireSession } from "@/lib/auth/session";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { brand } from "@/lib/brand";
import { filterToVerdict, parseFilter } from "@/lib/decisiones";
import { businessTimezone } from "@/server/analytics/period";
import { listConversationDecisions, listDecisions } from "@/server/agencia/decisions-read";
import { DecisionesClient } from "@/components/agencia/centro/decisiones";

export const dynamic = "force-dynamic";

const PAGE = 50;

/**
 * Capa de agencia (fork) — «Cómo decidió el agente»: cada turno real del
 * agente, con lo que le escribieron, lo que hizo y lo que contestó, para
 * calificarlo (Bien / Falló). Lee lo mismo que `GET /api/decisions`, con el
 * mismo alcance por organización; el filtro y la página viajan en la URL.
 */
export default async function DecisionesPage({
  searchParams,
}: {
  searchParams: Promise<{ f?: string; cursor?: string; c?: string }>;
}) {
  const params = await searchParams;
  const session = await requireSession();
  const filter = parseFilter(params.f);

  // `?c=` limita a una conversación (el enlace de su ficha en Conversaciones).
  // El listado ya filtra por organización: el id de otro negocio no devuelve nada.
  const conversationId = /^[A-Za-z0-9_-]{1,64}$/.test(params.c ?? "") ? params.c! : null;
  const page = conversationId
    ? await listConversationDecisions(session.organizationId, conversationId, { limit: PAGE, cursor: params.cursor })
    : await listDecisions(session.organizationId, { limit: PAGE, cursor: params.cursor, verdict: filterToVerdict(filter) });
  // Un cursor que no emitimos nosotros: se vuelve a la primera página.
  if (page === "invalid_cursor") redirect(conversationId ? `/decisiones?c=${conversationId}` : filter === "todas" ? "/decisiones" : `/decisiones?f=${filter}`);

  // El enlace a la conversación va por contacto (`/inbox?contact=`).
  const conversationIds = [...new Set(page.decisions.map((d) => d.conversationId))];
  const contacts = conversationIds.length
    ? await getDb()
        .select({ id: schema.conversation.id, contactId: schema.conversation.contactId })
        .from(schema.conversation)
        .where(scoped(schema.conversation.organizationId, session.organizationId, inArray(schema.conversation.id, conversationIds)))
    : [];
  const contactOf = new Map(contacts.map((c) => [c.id, c.contactId]));

  return (
    <DecisionesClient
      // La lista de otra página o de otro filtro es otra lista: el estado no se arrastra.
      key={`${conversationId ?? ""}:${filter}:${params.cursor ?? ""}`}
      initial={page.decisions.map((d) => ({ ...d, contactId: contactOf.get(d.conversationId) ?? null }))}
      nextCursor={page.nextCursor}
      filter={conversationId ? "todas" : filter}
      conversationId={conversationId}
      onFirstPage={!params.cursor}
      // Calificar es del propietario (la API lo exige); un miembro lee.
      canJudge={session.role === "owner"}
      timezone={await businessTimezone(session.organizationId)}
      productLabel={brand().name}
    />
  );
}

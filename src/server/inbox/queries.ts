import { and, desc, eq, gt, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { isWindowOpen, windowRemainingMs } from "@/server/inbox/window";
import type { ConversationDto } from "@/lib/types";
import { DEFAULT_BUSINESS_HOURS, getBusinessHours, type BusinessHoursSettings } from "@/server/business-hours";
import { pausaInfo } from "@/server/agencia/pausa-manual";

/**
 * 018 — El anuncio de origen viaja con la conversación. La llave única
 * (organización, conversación) garantiza a lo más una fila por renglón, así
 * que el LEFT JOIN no multiplica la lista.
 */
const anuncioDeLaConversacion = and(
  eq(schema.adAttribution.organizationId, schema.conversation.organizationId),
  eq(schema.adAttribution.conversationId, schema.conversation.id)
);

const anuncioDeLista = {
  id: schema.adAttribution.id,
  headline: schema.adAttribution.headline,
  sourceId: schema.adAttribution.sourceId,
  sourceType: schema.adAttribution.sourceType,
};

function aAnuncioDeLista(
  fila: {
    id: string | null;
    headline: string | null;
    sourceId: string | null;
    sourceType: string | null;
  } | null
): ConversationDto["anuncio"] {
  // Sin fila, drizzle devuelve el objeto con todo en null (o null a secas).
  if (!fila?.id) return null;
  return {
    headline: fila.headline,
    sourceId: fila.sourceId,
    sourceType: fila.sourceType,
  };
}

export async function listConversations(
  organizationId: string,
  since?: Date
): Promise<ConversationDto[]> {
  const db = getDb();
  const previewSql = sql<string | null>`(
    select coalesce(m.text, m.type)
    from message m
    where m.organization_id = ${schema.conversation.organizationId}
      and m.conversation_id = ${schema.conversation.id}
    order by m.created_at desc
    limit 1
  )`;
  const stageSql = sql<string | null>`(
    select s.name from lead l
    join pipeline_stage s on s.id = l.stage_id
    where l.contact_id = ${schema.contact.id}
    limit 1
  )`;

  const rows = await db
    .select({
      conversation: schema.conversation,
      contact: schema.contact,
      preview: previewSql,
      stageName: stageSql,
      anuncio: anuncioDeLista,
    })
    .from(schema.conversation)
    .innerJoin(
      schema.contact,
      eq(schema.conversation.contactId, schema.contact.id)
    )
    .leftJoin(schema.adAttribution, anuncioDeLaConversacion)
    .where(
      scoped(
        schema.conversation.organizationId,
        organizationId,
        eq(schema.conversation.isTest, false),
        since ? gt(schema.conversation.updatedAt, since) : undefined
      )
    )
    .orderBy(desc(sql`coalesce(${schema.conversation.lastMessageAt}, ${schema.conversation.createdAt})`));

  // Una sola lectura por lista: la regla de la pausa es del negocio, no del chat.
  const horario = await getBusinessHours(organizationId);
  return rows.map((r) =>
    serializeConversation(
      r.conversation,
      r.contact,
      r.preview,
      r.stageName,
      aAnuncioDeLista(r.anuncio),
      horario
    )
  );
}

export async function getConversation(
  organizationId: string,
  conversationId: string
) {
  const db = getDb();
  const rows = await db
    .select({
      conversation: schema.conversation,
      contact: schema.contact,
      anuncio: anuncioDeLista,
    })
    .from(schema.conversation)
    .innerJoin(
      schema.contact,
      eq(schema.conversation.contactId, schema.contact.id)
    )
    .leftJoin(schema.adAttribution, anuncioDeLaConversacion)
    .where(
      scoped(
        schema.conversation.organizationId,
        organizationId,
        eq(schema.conversation.id, conversationId)
      )
    )
    .limit(1);
  const row = rows[0];
  return row ? { ...row, anuncio: aAnuncioDeLista(row.anuncio) } : null;
}

/** Mensajes por página del hilo: un chat de meses no se baja entero. */
export const MESSAGES_PAGE = 80;

/**
 * Mensajes de una conversación en orden cronológico.
 * - `since`: todo lo posterior (catch-up incremental), sin tope.
 * - `beforeId`: la página anterior a ese mensaje. El cursor es el mensaje y no
 *   su hora: la base guarda microsegundos y el JSON milisegundos, y dos
 *   mensajes del mismo instante (un historial importado) no deben perderse.
 * - sin ninguno: la última página.
 * `hasMore` dice si quedan mensajes más viejos que la página devuelta.
 */
export async function listMessages(
  organizationId: string,
  conversationId: string,
  opts: { since?: Date; beforeId?: string; limit?: number } = {}
) {
  const db = getDb();
  const base = db
    .select({ message: schema.message, media: schema.mediaAsset })
    .from(schema.message)
    .leftJoin(
      schema.mediaAsset,
      eq(schema.message.mediaAssetId, schema.mediaAsset.id)
    );
  if (opts.since) {
    const rows = await base
      .where(
        scoped(
          schema.message.organizationId,
          organizationId,
          eq(schema.message.conversationId, conversationId),
          gt(schema.message.createdAt, opts.since)
        )
      )
      .orderBy(schema.message.createdAt);
    return { rows, hasMore: false };
  }
  const limit = opts.limit ?? MESSAGES_PAGE;
  const rows = await base
    .where(
      scoped(
        schema.message.organizationId,
        organizationId,
        eq(schema.message.conversationId, conversationId),
        opts.beforeId
          ? sql`(${schema.message.createdAt}, ${schema.message.id}) < (
              select m.created_at, m.id from message m
              where m.id = ${opts.beforeId} and m.organization_id = ${organizationId})`
          : undefined
      )
    )
    .orderBy(desc(schema.message.createdAt), desc(schema.message.id))
    .limit(limit + 1);
  const hasMore = rows.length > limit;
  return { rows: rows.slice(0, limit).reverse(), hasMore };
}

export function serializeConversation(
  c: typeof schema.conversation.$inferSelect,
  contact: typeof schema.contact.$inferSelect,
  preview: string | null = null,
  stageName: string | null = null,
  anuncio: ConversationDto["anuncio"] = null,
  horario: BusinessHoursSettings = DEFAULT_BUSINESS_HOURS
): ConversationDto {
  return {
    id: c.id,
    channel: c.channel,
    contact: { id: contact.id, name: contact.name, phone: contact.phone },
    stageName,
    aiEnabled: c.aiEnabled,
    handoffAt: c.handoffAt?.toISOString() ?? null,
    handoffReason: c.handoffReason,
    lastInboundAt: c.lastInboundAt?.toISOString() ?? null,
    lastMessageAt: c.lastMessageAt?.toISOString() ?? null,
    unreadCount: c.unreadCount,
    windowOpen: isWindowOpen(c.lastInboundAt),
    windowRemainingMs: windowRemainingMs(c.lastInboundAt),
    preview,
    anuncio,
    ...pausaInfo(c, horario),
  };
}

export async function updateConversation(
  organizationId: string,
  conversationId: string,
  patch: { aiEnabled?: boolean; reactivate?: boolean; markRead?: boolean }
) {
  const db = getDb();
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.aiEnabled !== undefined) {
    set.aiEnabled = patch.aiEnabled;
    // Fork — pausa que vence: el interruptor es una decisión explícita y
    // reemplaza la pausa automática del teléfono (apagar = queda apagada,
    // sin vencer; encender = retoma ya). Un traspaso del agente no se toca.
    set.handoffAt = sql`case when ${schema.conversation.handoffReason} = 'manual_reply' then null else ${schema.conversation.handoffAt} end`;
    set.handoffReason = sql`case when ${schema.conversation.handoffReason} = 'manual_reply' then null else ${schema.conversation.handoffReason} end`;
  }
  if (patch.reactivate) {
    set.handoffAt = null;
    set.handoffReason = null;
    set.aiEnabled = patch.aiEnabled ?? true;
  }
  if (patch.markRead) set.unreadCount = 0;

  const updated = await db
    .update(schema.conversation)
    .set(set)
    .where(
      and(
        eq(schema.conversation.organizationId, organizationId),
        eq(schema.conversation.id, conversationId)
      )
    )
    .returning();
  return updated[0] ?? null;
}

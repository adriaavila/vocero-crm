import { and, eq, gt, isNull, ne, not } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { serializeFicha } from "@/server/bot/ficha";
// Capa de agencia: allowlist del piloto y la cita que el lead ya tiene.
import { accesoDeAgencia, proximaCita } from "@/server/agencia/bot-perfil";
import { isWindowOpen, windowRemainingMs } from "@/server/inbox/window";
import { hasSaaSPlan } from "@/server/agencia/entitlements";

/**
 * Constructor ÚNICO del contexto conversacional para un cerebro externo.
 *
 * `GET /api/bot/context` y el payload de despacho a Nea (dispatch v2) usan
 * EXACTAMENTE esta función — nunca arman el objeto por su cuenta — para que
 * los dos caminos no puedan divergir en silencio.
 *
 * NO incluye el historial de mensajes (eso es `history`, en el payload de
 * despacho): esto es lo que solo el CRM sabe — quién es la persona, si un
 * humano tomó el control, si la ventana de 24 h sigue abierta y de qué
 * anuncio vino, no lo que se dijeron.
 */

export type BotContext = {
  contact: {
    id: string;
    name: string;
    identity: string;
    /** Alias heredado de `identity` — contrato publicado, no tiene fecha de retiro. */
    waIdentity: string;
    channel: string;
    phone: string | null;
    ficha: ReturnType<typeof serializeFicha>;
  };
  conversation: {
    id: string;
    aiEnabled: boolean;
    handoffAt: string | null;
    handoffReason: string | null;
    windowOpen: boolean;
    windowRemainingMs: number;
    /**
     * Dispatch v2: true si ya existe un saliente `origin=ai` no fallido
     * posterior a `memory_reset_at` — Nea lo usa para saber si ya se presentó
     * en esta memoria (tras un reset, vuelve a `false` hasta su próxima
     * respuesta).
     */
    agentHasSpoken: boolean;
  };
  lead: { id: string; stageName: string } | null;
  agentAccess: Awaited<ReturnType<typeof accesoDeAgencia>>;
  booking: { next: Awaited<ReturnType<typeof proximaCita>> };
  /** Dispatch v2: el anuncio de origen de la conversación, o null si no vino de uno. */
  adOrigen: {
    headline: string | null;
    body: string | null;
    sourceId: string | null;
    sourceType: string | null;
    sourceUrl: string | null;
  } | null;
};

export async function buildBotContext(
  organizationId: string,
  conversationId: string
): Promise<BotContext | null> {
  const db = getDb();

  const rows = await db
    .select({ conversation: schema.conversation, contact: schema.contact })
    .from(schema.conversation)
    .innerJoin(schema.contact, eq(schema.conversation.contactId, schema.contact.id))
    .where(
      and(
        eq(schema.conversation.organizationId, organizationId),
        eq(schema.conversation.id, conversationId)
      )
    )
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  const { conversation, contact } = row;

  const proEnabled = await hasSaaSPlan(organizationId, "pro");
  const leadRows = proEnabled
    ? await db
        .select({ lead: schema.lead, stage: schema.pipelineStage })
        .from(schema.lead)
        .innerJoin(schema.pipelineStage, eq(schema.lead.stageId, schema.pipelineStage.id))
        .where(
          and(
            eq(schema.lead.organizationId, organizationId),
            eq(schema.lead.contactId, contact.id)
          )
        )
        .limit(1)
    : [];

  const [agentAccess, booking, agentHasSpoken, adAttributionRows] = await Promise.all([
    accesoDeAgencia(organizationId),
    proEnabled ? proximaCita(organizationId, contact.id) : Promise.resolve(null),
    hasAgentSpoken(organizationId, conversationId, conversation.memoryResetAt),
    db
      .select({
        headline: schema.adAttribution.headline,
        body: schema.adAttribution.body,
        sourceId: schema.adAttribution.sourceId,
        sourceType: schema.adAttribution.sourceType,
        sourceUrl: schema.adAttribution.sourceUrl,
      })
      .from(schema.adAttribution)
      .where(
        and(
          eq(schema.adAttribution.organizationId, organizationId),
          eq(schema.adAttribution.conversationId, conversationId)
        )
      )
      .limit(1),
  ]);

  return {
    contact: {
      id: contact.id,
      name: contact.name,
      /** Nombre neutro (014). Preferir este en clientes nuevos. */
      identity: contact.waIdentity,
      /** Alias heredado: sigue aquí para no romper bots ya desplegados. */
      waIdentity: contact.waIdentity,
      channel: contact.channel,
      phone: contact.phone,
      ficha: serializeFicha(contact),
    },
    conversation: {
      id: conversation.id,
      // Una sola verdad para el bot: si hay handoff, la IA está apagada
      // aunque el flag siga en true.
      aiEnabled: conversation.aiEnabled && !conversation.handoffAt,
      handoffAt: conversation.handoffAt?.toISOString() ?? null,
      handoffReason: conversation.handoffReason,
      windowOpen: isWindowOpen(conversation.lastInboundAt),
      windowRemainingMs: windowRemainingMs(conversation.lastInboundAt),
      agentHasSpoken,
    },
    lead: leadRows[0]
      ? { id: leadRows[0].lead.id, stageName: leadRows[0].stage.name }
      : null,
    agentAccess,
    booking: { next: booking },
    adOrigen: adAttributionRows[0] ?? null,
  };
}

/**
 * true si existe un saliente `origin=ai` no fallido posterior a
 * `memoryResetAt` (o a cualquier momento, si nunca hubo reset).
 *
 * Excluye una reserva viva (`sendTextIdempotent` inserta `pending` sin
 * `wa_message_id` ANTES de llamar a Graph): mientras no se confirma, no es
 * un hecho que el agente "ya habló" — un envío que todavía puede fallar y
 * borrarse no debe contar.
 */
async function hasAgentSpoken(
  organizationId: string,
  conversationId: string,
  memoryResetAt: Date | null
): Promise<boolean> {
  const since = memoryResetAt ?? new Date(0);
  const rows = await getDb()
    .select({ id: schema.message.id })
    .from(schema.message)
    .where(
      and(
        eq(schema.message.organizationId, organizationId),
        eq(schema.message.conversationId, conversationId),
        eq(schema.message.direction, "out"),
        eq(schema.message.origin, "ai"),
        ne(schema.message.status, "failed"),
        not(and(isNull(schema.message.waMessageId), eq(schema.message.status, "pending"))!),
        gt(schema.message.createdAt, since)
      )
    )
    .limit(1);
  return rows.length > 0;
}

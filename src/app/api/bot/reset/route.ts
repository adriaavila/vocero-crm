import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/lib/db";
import { apiError, parseBody } from "@/lib/api";
import { isNeaBrain } from "@/lib/env";
import { neaMessageId } from "@/lib/db/ids";
import { requireBotKey, resolveInstanceOrg } from "@/server/bot/auth";
import { publish } from "@/server/events/bus";
import { moveLeadToStage } from "@/server/leads/stage-history";
import { serializeFicha, upsertFicha } from "@/server/bot/ficha";
import { SendError, sendText } from "@/server/inbox/send";
import { persistTestOutbound } from "@/server/ai/pipeline";
import { clearOffers } from "@/server/agenda/offers";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  conversationId: z.string().min(1),
  /** Aviso a mandar ANTES de fijar memory_reset_at (p. ej. "empezamos de nuevo"). */
  notice: z.string().min(1).max(4096).optional(),
  /** El MISMO id del despacho — hace idempotente el envío del aviso. */
  dispatchId: z.string().min(1).optional(),
});

/**
 * Reinicio de UNA conversación para la línea de pruebas del operador: IA
 * reactivada (sale del handoff) y lead de vuelta a la primera etapa. El
 * historial del inbox NO se borra: es auditoría. Lo invoca el cerebro externo
 * cuando un número de su allowlist manda `/reset`.
 *
 * Dispatch v2, orden EXACTO (revisado tras un bug: mandar el aviso antes de
 * salir del handoff hacía que `/reset` de una conversación pausada — el caso
 * más común, es justo POR QUÉ alguien resetea — fallara con 409 y el reset
 * entero no ocurriera):
 *  1. Reactiva (sale del handoff, `aiEnabled=true`) — como el reset de
 *     siempre, PRIMERO.
 *  2. Con `notice`: se manda YA reactivada (nunca 409 `ai_paused` por un
 *     handoff que este mismo reset acaba de limpiar). En una conversación de
 *     prueba (Laboratorio) se persiste como saliente de prueba
 *     (`persistTestOutbound`, igual que `/api/bot/messages`) en vez de
 *     `sendText` — esas conversaciones jamás tocan la API real.
 *  3. Fija `memory_reset_at = now()` — así el aviso mismo (con un `createdAt`
 *     de ANTES de este paso) no vuelve a aparecer en `history` de despachos
 *     futuros, y la memoria de Nea arranca de cero desde este instante.
 *  4. Limpia las ofertas vigentes: un slot ofrecido antes del reset no debe
 *     poder reservarse después de que la conversación "empezó de nuevo".
 */
export async function POST(req: Request) {
  const denied = requireBotKey(req);
  if (denied) return denied;

  const organizationId = await resolveInstanceOrg(req);
  if (!organizationId) {
    return apiError(409, "no_org", "La instancia aún no tiene organización");
  }

  const body = await parseBody(req, bodySchema);
  if (!body.ok) return body.response;

  const db = getDb();
  const rows = await db
    .select({
      id: schema.conversation.id,
      organizationId: schema.conversation.organizationId,
      contactId: schema.conversation.contactId,
      isTest: schema.conversation.isTest,
    })
    .from(schema.conversation)
    .where(
      and(
        eq(schema.conversation.organizationId, organizationId),
        eq(schema.conversation.id, body.data.conversationId)
      )
    )
    .limit(1);
  const conv = rows[0];
  if (!conv) return apiError(404, "not_found", "Conversación no encontrada");

  // 1. Reactiva PRIMERO: un notice contra una conversación en handoff no debe
  // fallar con `ai_paused` solo porque este mismo reset todavía no la limpió.
  await db
    .update(schema.conversation)
    .set({
      aiEnabled: true,
      handoffAt: null,
      handoffReason: null,
      updatedAt: new Date(),
    })
    .where(eq(schema.conversation.id, conv.id));

  // 2. El aviso, ya reactivada.
  if (body.data.notice) {
    if (conv.isTest && isNeaBrain()) {
      // Laboratorio: jamás toca la API real (FR-031) — se persiste igual que
      // Nea contestando por `/api/bot/messages`.
      const messageId = body.data.dispatchId
        ? neaMessageId(organizationId, conv.id, body.data.dispatchId, 0)
        : undefined;
      await persistTestOutbound(conv, body.data.notice, { messageId });
    } else {
      try {
        await sendText({
          conversationId: conv.id,
          organizationId,
          text: body.data.notice,
          aiGenerated: true,
          dispatchId: body.data.dispatchId,
          seq: 0,
        });
      } catch (err) {
        if (err instanceof SendError) {
          if (err.code === "ai_disabled") return apiError(409, "ai_paused", err.message);
          if (err.code === "window_closed") return apiError(409, "window_closed", err.message);
          if (err.code === "sandbox_violation") return apiError(409, "sandbox_violation", err.message);
          if (err.code === "billing_inactive") return apiError(402, "billing_inactive", err.message);
          if (err.code === "outside_hours") return apiError(409, "outside_hours", err.message);
          if (err.code === "send_in_progress") return apiError(409, "send_in_progress", err.message);
          return apiError(502, err.code, err.message);
        }
        throw err;
      }
    }
  }

  // 3. La memoria de Nea arranca de cero DESPUÉS del aviso: su propio
  // `createdAt` queda antes del corte y no vuelve a aparecer en `history`.
  await db
    .update(schema.conversation)
    .set({ memoryResetAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.conversation.id, conv.id));

  // 4. Ofertas vigentes fuera: un slot de antes del reset no se reserva después.
  await clearOffers(organizationId, conv.id).catch((err) => {
    console.warn(`[bot/reset] no se pudieron limpiar las ofertas: ${err}`);
  });

  // La ficha se vacía POR LA PUERTA (`upsertFicha`), no con un update suelto:
  // esa puerta es la que filtra por organización, y el guardarraíl de
  // tests/unit/ficha-guard.test.ts existe justo para que nadie la esquive.
  // Borrar = mandar `null` en cada clave que había.
  const previas = await db
    .select()
    .from(schema.contact)
    .where(
      and(
        eq(schema.contact.organizationId, organizationId),
        eq(schema.contact.id, conv.contactId)
      )
    )
    .limit(1);
  if (previas[0]) {
    const claves = Object.keys(serializeFicha(previas[0]));
    if (claves.length > 0) {
      await upsertFicha({
        organizationId,
        contactId: conv.contactId,
        ficha: Object.fromEntries(claves.map((k) => [k, null])),
      });
    }
  }

  // Etapa al inicio del funnel (best-effort: sin etapas no revienta el reset).
  try {
    const stages = await db
      .select()
      .from(schema.pipelineStage)
      .where(eq(schema.pipelineStage.organizationId, organizationId));
    const first = [...stages].sort((a, b) => a.position - b.position)[0];
    const leadRows = await db
      .select({ id: schema.lead.id })
      .from(schema.lead)
      .where(
        and(
          eq(schema.lead.organizationId, organizationId),
          eq(schema.lead.contactId, conv.contactId)
        )
      )
      .limit(1);
    if (first && leadRows[0]) {
      // Por la puerta única: devolver la conversación de pruebas al inicio
      // también es un movimiento, y la bitácora tiene que poder explicar por
      // qué un lead retrocedió de etapa.
      await moveLeadToStage({
        organizationId,
        leadId: leadRows[0].id,
        toStageId: first.id,
        source: "sistema",
      });
    }
  } catch (err) {
    console.warn(`[bot/reset] reinicio de etapa falló: ${err}`);
  }

  publish(organizationId, {
    type: "conversation.updated",
    data: { conversation: { id: conv.id } },
  });
  return Response.json({ ok: true });
}

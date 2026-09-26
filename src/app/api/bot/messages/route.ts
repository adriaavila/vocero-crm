import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/lib/db";
import { apiError, parseBody } from "@/lib/api";
import { isNeaBrain } from "@/lib/env";
import { neaMessageId } from "@/lib/db/ids";
import { requireBotKey, resolveInstanceOrg } from "@/server/bot/auth";
import { SendError, sendText } from "@/server/inbox/send";
import { persistTestOutbound } from "@/server/ai/pipeline";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  conversationId: z.string().min(1),
  text: z.string().min(1).max(4096),
  /**
   * Dispatch v2: el MISMO id que este despacho recibió en su payload. Con él,
   * el envío es idempotente por `(organización, conversación, dispatchId,
   * seq)` — un reintento del mismo turno no duplica la respuesta.
   */
  dispatchId: z.string().min(1).optional(),
  /** Varios mensajes de UN mismo despacho; default 0. */
  seq: z.number().int().min(0).optional(),
});

/**
 * Envío del cerebro externo A TRAVÉS del CRM: el token de WhatsApp nunca sale
 * de aquí. Usa el mismo camino que el composer de la bandeja (`sendText`), así
 * que el mensaje queda en el hilo marcado como IA, respeta la ventana de 24 h
 * y hereda el guard de sandbox del Laboratorio.
 *
 * 409 tipados: ai_paused (un humano tomó la conversación) · window_closed ·
 * sandbox_violation · send_in_progress (dispatch v2: mismo dispatchId+seq
 * todavía en vuelo).
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

  // Gate de handoff: el bot JAMÁS habla sobre una conversación pausada. Se
  // relee aquí porque entre que el bot pidió el contexto y armó su respuesta
  // (segundos de un LLM) el dueño pudo haber tomado la conversación.
  const db = getDb();
  const convs = await db
    .select({
      id: schema.conversation.id,
      organizationId: schema.conversation.organizationId,
      isTest: schema.conversation.isTest,
      aiEnabled: schema.conversation.aiEnabled,
      handoffAt: schema.conversation.handoffAt,
    })
    .from(schema.conversation)
    .where(
      and(
        eq(schema.conversation.organizationId, organizationId),
        eq(schema.conversation.id, body.data.conversationId)
      )
    )
    .limit(1);
  const conv = convs[0];
  if (!conv) return apiError(404, "not_found", "Conversación no encontrada");
  if (!conv.aiEnabled || conv.handoffAt) {
    return apiError(409, "ai_paused", "La IA está en pausa en esta conversación");
  }

  // Laboratorio CON Nea: el runner llama a `runAgentTurn` directo (sin pasar
  // por esta ruta), pero Nea SÍ contesta por aquí — se persiste como saliente
  // de prueba y JAMÁS toca la API real (FR-031).
  //
  // SIN Nea (comportamiento de `main`, sin cambios): un cerebro externo
  // legado jamás debería estar hablándole a una conversación de prueba — esas
  // no son alcanzables desde fuera a propósito — así que aquí sigue el
  // guardarraíl duro de siempre: 409 `sandbox_violation` vía `sendText`.
  if (conv.isTest && isNeaBrain()) {
    const testMessageId = body.data.dispatchId
      ? neaMessageId(organizationId, conv.id, body.data.dispatchId, body.data.seq ?? 0)
      : undefined;
    const result = await persistTestOutbound(conv, body.data.text, { messageId: testMessageId });
    return Response.json(
      result.duplicate
        ? { messageId: result.messageId, duplicate: true }
        : { messageId: result.messageId }
    );
  }

  try {
    const result = await sendText({
      conversationId: body.data.conversationId,
      organizationId,
      text: body.data.text,
      aiGenerated: true,
      dispatchId: body.data.dispatchId,
      seq: body.data.seq,
    });
    return Response.json(
      result.duplicate
        ? { messageId: result.messageId, duplicate: true }
        : { messageId: result.messageId }
    );
  } catch (err) {
    if (err instanceof SendError) {
      // La IA se pausó ENTRE el gate de arriba y la entrega (segundos de un
      // LLM). Es el mismo hecho que `ai_paused`, así que sale con el mismo
      // código: quien integra no debería tener que distinguir dos nombres
      // para "un humano tomó la conversación".
      if (err.code === "ai_disabled") {
        return apiError(409, "ai_paused", err.message);
      }
      if (err.code === "window_closed") {
        return apiError(409, "window_closed", err.message);
      }
      if (err.code === "sandbox_violation") {
        return apiError(409, "sandbox_violation", err.message);
      }
      if (err.code === "billing_inactive") {
        return apiError(402, "billing_inactive", err.message);
      }
      if (err.code === "outside_hours") {
        return apiError(409, "outside_hours", err.message);
      }
      if (err.code === "send_in_progress") {
        return apiError(409, "send_in_progress", err.message);
      }
      return apiError(502, err.code, err.message);
    }
    throw err;
  }
}

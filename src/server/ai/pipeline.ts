import { and, asc, desc, eq, gte } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { moveLeadToStage as moveLeadThroughHistory } from "@/server/leads/stage-history";
import { getEnv, isNeaBrain } from "@/lib/env";
import { chatJson, type ChatMessage } from "@/lib/ai";
import { getAiRuntimeConfig, hasConfiguredAiProvider } from "@/server/ai/credentials";
import {
  buildNeaPayload,
  dispatchToNea,
  selectMessagesForNea,
  type NeaSourceMessage,
} from "@/server/ai/nea-dispatch";
import { publish } from "@/server/events/bus";
import { isWindowOpen } from "@/server/inbox/window";
import { SendError, sendText } from "@/server/inbox/send";
import {
  agentActionSchema,
  degradeAction,
  resolveStage,
  type AgentActionType,
} from "@/server/ai/actions";
import { matchesHandoffIntent } from "@/server/ai/handoff";
import { buildAgentSystemPrompt } from "@/server/ai/prompts";
import { agendaEnabled } from "@/server/agenda/flag";
import { getSettings } from "@/server/agenda/settings";
import { bookSlot, offerSlots } from "@/server/agenda/agent";
import { canAutomate, hasSaaSPlan } from "@/server/agencia/entitlements";
import { isAllokSaaSMode } from "@/lib/tenant-host";
import { canAgentRespondNow } from "@/server/business-hours";

/**
 * Turno del agente (FR-021..FR-025).
 *
 * Coalesce + lock in-process por conversación: ráfagas de mensajes → UNA
 * respuesta; nunca dos turnos simultáneos; lo que llega durante un turno
 * re-encola exactamente un turno más. Suficiente para el monolito de una
 * instancia (sin colas externas — Constitución II).
 */

type CoalesceEntry = {
  timer: ReturnType<typeof setTimeout> | null;
  running: boolean;
  pending: boolean;
};

const globalForAgent = globalThis as unknown as {
  __agentCoalesce?: Map<string, CoalesceEntry>;
};

function coalesceMap(): Map<string, CoalesceEntry> {
  if (!globalForAgent.__agentCoalesce) {
    globalForAgent.__agentCoalesce = new Map();
  }
  return globalForAgent.__agentCoalesce;
}

/** Punto de entrada con debounce (mensajes entrantes reales). */
function scheduleLegacyAgentTurn(conversationId: string): void {
  const map = coalesceMap();
  const entry = map.get(conversationId) ?? {
    timer: null,
    running: false,
    pending: false,
  };
  map.set(conversationId, entry);

  if (entry.running) {
    entry.pending = true; // se re-encola al terminar el turno actual
    return;
  }
  if (entry.timer) clearTimeout(entry.timer);
  const delay = getEnv().AGENT_COALESCE_MS;
  entry.timer = setTimeout(() => {
    entry.timer = null;
    void executeTurn(conversationId);
  }, delay);
}

export async function scheduleAgentTurn(conversationId: string): Promise<void> {
  if (!isAllokSaaSMode()) {
    scheduleLegacyAgentTurn(conversationId);
    return;
  }
  const db = getDb();
  const conversation = await db
    .select({ organizationId: schema.conversation.organizationId })
    .from(schema.conversation)
    .where(eq(schema.conversation.id, conversationId))
    .limit(1);
  const organizationId = conversation[0]?.organizationId;
  if (!organizationId) return;

  const now = new Date();
  const availableAt = new Date(now.getTime() + getEnv().AGENT_COALESCE_MS);
  await db
    .insert(schema.agentJob)
    .values({
      id: newId("agentJob"),
      organizationId,
      conversationId,
      availableAt,
    })
    .onConflictDoNothing();
  await db
    .update(schema.agentJob)
    .set({ availableAt, updatedAt: now })
    .where(
      and(
        eq(schema.agentJob.conversationId, conversationId),
        eq(schema.agentJob.status, "queued"),
      )
    );
  void import("./worker").then(({ kickAgentWorker }) => kickAgentWorker());
}

async function executeTurn(conversationId: string): Promise<void> {
  const map = coalesceMap();
  const entry = map.get(conversationId);
  if (!entry || entry.running) return;
  entry.running = true;
  try {
    await runAgentTurn(conversationId);
  } catch (err) {
    console.error("[agente] turno falló:", err);
    // Con Nea: mismo trato que el worker de SaaS ante un despacho que agotó
    // sus reintentos — un humano se entera por el handoff en vez de que la
    // conversación se quede pausada en silencio. Con Rei: EXACTAMENTE el
    // comportamiento de `main`, solo log — un fallo del LLM interno no debe
    // escalar a un humano solo, es lo que ya decide `applyHandoff("error")`
    // más arriba en `runAgentTurn` cuando corresponde.
    if (isNeaBrain()) {
      await applyHandoffOnFailure(conversationId).catch(() => {});
    }
  } finally {
    entry.running = false;
    if (entry.pending) {
      entry.pending = false;
      void executeTurn(conversationId);
    } else {
      map.delete(conversationId);
    }
  }
}

/** Handoff `error` para el conversationId de un turno legado que reventó. */
async function applyHandoffOnFailure(conversationId: string): Promise<void> {
  const rows = await getDb()
    .select({ organizationId: schema.conversation.organizationId })
    .from(schema.conversation)
    .where(eq(schema.conversation.id, conversationId))
    .limit(1);
  const organizationId = rows[0]?.organizationId;
  if (!organizationId) return;
  await applyHandoff(conversationId, organizationId, "error");
}

/**
 * Ejecuta UN turno del agente ahora (el Laboratorio lo llama directo, con
 * debounce 0 y sin pasar por el coalesce).
 */
export async function runAgentTurn(conversationId: string): Promise<void> {
  if (isNeaBrain()) {
    await runNeaAgentTurn(conversationId);
    return;
  }
  const db = getDb();
  const convRows = await db
    .select()
    .from(schema.conversation)
    .where(eq(schema.conversation.id, conversationId))
    .limit(1);
  const conversation = convRows[0];
  if (!conversation) return;
  const organizationId = conversation.organizationId;
  const aiConfig = await getAiRuntimeConfig(organizationId);
  if (!hasConfiguredAiProvider(aiConfig)) return;

  // Condiciones de silencio: handoff activo o IA apagada en la conversación.
  if (conversation.handoffAt || !conversation.aiEnabled) return;

  const profileRows = await db
    .select()
    .from(schema.agentProfile)
    .where(eq(schema.agentProfile.organizationId, organizationId))
    .limit(1);
  const profile = profileRows[0];
  if (!profile) return;
  // El toggle global aplica a conversaciones reales; el Laboratorio evalúa el
  // comportamiento configurado aunque el agente aún no esté encendido.
  if (!conversation.isTest && !profile.enabled) return;
  if (!conversation.isTest && isAllokSaaSMode() && !(await canAgentRespondNow(organizationId))) return;

  const history = await db
    .select()
    .from(schema.message)
    .where(eq(schema.message.conversationId, conversationId))
    .orderBy(desc(schema.message.createdAt))
    .limit(20);
  history.reverse();
  const lastInbound = [...history].reverse().find((m) => m.direction === "in");
  if (!lastInbound) return;

  // Ventana cerrada: el agente JAMÁS envía texto libre → handoff 'ventana'.
  if (!conversation.isTest && !isWindowOpen(conversation.lastInboundAt)) {
    await applyHandoff(conversationId, organizationId, "ventana");
    return;
  }

  // Patrón de respaldo ANTES del LLM (FR-022).
  if (lastInbound.text && matchesHandoffIntent(lastInbound.text)) {
    await applyHandoff(conversationId, organizationId, "cliente");
    return;
  }

  const kb = await db
    .select()
    .from(schema.kbEntry)
    .where(eq(schema.kbEntry.organizationId, organizationId))
    .orderBy(asc(schema.kbEntry.createdAt));
  const proEnabled = await hasSaaSPlan(organizationId, "pro");
  const stages = proEnabled
    ? await db
        .select({ id: schema.pipelineStage.id, name: schema.pipelineStage.name })
        .from(schema.pipelineStage)
        .where(eq(schema.pipelineStage.organizationId, organizationId))
        .orderBy(asc(schema.pipelineStage.position))
    : [];

  const agenda = proEnabled && agendaEnabled();
  const settings = await getSettings(organizationId);
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: buildAgentSystemPrompt({
        profile,
        kb,
        stages,
        agenda,
        // Sin fecha de referencia el modelo no puede resolver "el jueves" ni
        // "mañana", y termina eligiendo un instante que no se le ofreció.
        timezone: settings.timezone,
      }),
    },
    ...history
      .filter((m) => m.text)
      .map((m) => ({
        role: m.direction === "in" ? ("user" as const) : ("assistant" as const),
        content: m.text!,
      })),
  ];

  const result = await chatJson(agentActionSchema(agenda), messages, {
    provider: profile.aiProvider,
    credentials: aiConfig.providers,
  });
  if (!result.ok) {
    if (result.error === "not_configured") return;
    // Fallo persistente del proveedor o salida imposible → escalar (FR-022).
    console.error(`[agente] fallo del proveedor (raw): ${result.detail}`);
    await applyHandoff(conversationId, organizationId, "error");
    return;
  }

  let action: AgentActionType = result.data;

  // 015 — Agenda. Un fallo del motor degrada el turno (el agente responde sin
  // agendar), nunca lo tumba: quedarse callado es peor que no agendar.
  if (action.action === "offer_slots" || action.action === "book_slot") {
    if (!agenda) {
      action = degradeAction(action);
    } else {
      try {
        const turn =
          action.action === "offer_slots"
            ? await offerSlots({
                organizationId,
                conversationId,
                intro: action.reply,
              })
            : await bookSlot({
                organizationId,
                conversationId,
                startUtc: action.startUtc,
                confirmation: action.reply,
              });
        await deliverReply(conversation, turn.text);
        if (turn.ok) {
          publish(organizationId, {
            type: "conversation.updated",
            data: { conversation: { id: conversationId } },
          });
        }
        return;
      } catch (err) {
        console.error(`[agente] el motor de agenda falló: ${err}`);
        action = degradeAction(action);
      }
    }
  }

  if (action.action === "move_stage") {
    const stage = resolveStage(action.stage, stages);
    if (!stage) {
      action = degradeAction(action);
    } else {
      await moveLeadToStage(organizationId, conversation.contactId, stage.id);
      publish(organizationId, {
        type: "conversation.updated",
        data: { conversation: { id: conversationId } },
      });
      if (action.reply) {
        await deliverReply(conversation, action.reply);
      }
      return;
    }
  }

  switch (action.action) {
    case "none":
      return;
    case "reply":
      await deliverReply(conversation, action.text);
      return;
    case "update_lead": {
      await appendLeadNote(organizationId, conversation.contactId, action.note);
      if (action.reply) await deliverReply(conversation, action.reply);
      return;
    }
    case "handoff": {
      if (action.farewell) {
        await deliverReply(conversation, action.farewell);
      }
      await applyHandoff(conversationId, organizationId, "modelo");
      return;
    }
  }
}

/**
 * El turno cuando Nea (cerebro externo) es el cerebro por defecto: el CRM
 * solo reúne lo que Nea necesita y le DESPACHA el turno completo — Nea decide
 * ventana, patrones de handoff, agenda y todo lo demás por su cuenta.
 *
 * Compuertas que sí quedan del lado del CRM (lo único que Nea no puede ver
 * sin preguntarle al CRM primero):
 *  - existe la conversación y el perfil del agente;
 *  - `profile.enabled` para conversaciones reales (el Laboratorio evalúa
 *    igual aunque el agente aún no esté encendido);
 *  - el horario de negocio en SaaS (`canAgentRespondNow`);
 *  - handoff activo o IA apagada en la conversación — EXCEPTO cuando el
 *    perfil tiene activación por mensajes (`activationEnabled`, columna
 *    `preset_only`): ahí Nea necesita ver la conversación pausada para poder
 *    reactivarla si el mensaje entrante coincide con la frase acordada;
 *  - al menos un mensaje entrante (sin eso no hay nada que despachar).
 */
async function runNeaAgentTurn(conversationId: string): Promise<void> {
  const db = getDb();
  const convRows = await db
    .select()
    .from(schema.conversation)
    .where(eq(schema.conversation.id, conversationId))
    .limit(1);
  const conversation = convRows[0];
  if (!conversation) return;
  const organizationId = conversation.organizationId;

  const profileRows = await db
    .select()
    .from(schema.agentProfile)
    .where(eq(schema.agentProfile.organizationId, organizationId))
    .limit(1);
  const profile = profileRows[0];
  if (!profile) return;

  if (!conversation.isTest && !profile.enabled) return;
  // Mismo freno de facturación que `sendText` aplica al entregar la respuesta
  // de Rei: sin esto, una organización con la automatización pausada seguía
  // recibiendo turnos despachados a Nea (que sí sabe cómo responder, así que
  // el guard tiene que estar ANTES del despacho, no después).
  if (!conversation.isTest && !(await canAutomate(organizationId))) return;
  if (!conversation.isTest && isAllokSaaSMode() && !(await canAgentRespondNow(organizationId))) {
    return;
  }
  if ((conversation.handoffAt || !conversation.aiEnabled) && !profile.activationEnabled) {
    return;
  }

  const contactRows = await db
    .select({ waIdentity: schema.contact.waIdentity, name: schema.contact.name })
    .from(schema.contact)
    .where(eq(schema.contact.id, conversation.contactId))
    .limit(1);
  const contact = contactRows[0];
  if (!contact) return;

  const sourceMessages = conversation.isTest
    ? await neaMessagesSinceLastOutbound(db, conversationId)
    : await neaRecentInboundMessages(db, conversationId);

  const payload = buildNeaPayload({
    organizationId,
    conversationId,
    isTest: conversation.isTest,
    contact: { identity: contact.waIdentity, name: contact.name },
    messages: sourceMessages,
  });
  if (!payload.messages.length) return;

  await dispatchToNea(payload);
}

type Db = ReturnType<typeof getDb>;

function toNeaSourceMessages(
  rows: {
    id: string;
    waMessageId: string | null;
    direction: "in" | "out";
    type: string;
    text: string | null;
    waTimestamp: Date | null;
    createdAt: Date;
    mediaWaId: string | null;
  }[]
): NeaSourceMessage[] {
  return rows.map((m) => ({
    id: m.id,
    waMessageId: m.waMessageId,
    direction: m.direction,
    type: m.type,
    text: m.text,
    mediaWaId: m.mediaWaId,
    timestamp: m.waTimestamp ?? m.createdAt,
  }));
}

/**
 * Laboratorio (`isTest`): los entrantes DESPUÉS del último saliente. Un
 * mensaje de prueba nunca trae `wa_message_id` (siempre `null`), así que Nea
 * no puede dedupearlos — hay que recortar exactamente a lo nuevo.
 */
async function neaMessagesSinceLastOutbound(
  db: Db,
  conversationId: string
): Promise<NeaSourceMessage[]> {
  const rows = await db
    .select({
      id: schema.message.id,
      waMessageId: schema.message.waMessageId,
      direction: schema.message.direction,
      type: schema.message.type,
      text: schema.message.text,
      waTimestamp: schema.message.waTimestamp,
      createdAt: schema.message.createdAt,
      mediaWaId: schema.mediaAsset.waMediaId,
    })
    .from(schema.message)
    .leftJoin(schema.mediaAsset, eq(schema.message.mediaAssetId, schema.mediaAsset.id))
    .where(eq(schema.message.conversationId, conversationId))
    .orderBy(desc(schema.message.createdAt))
    .limit(20);
  rows.reverse();
  return selectMessagesForNea(toNeaSourceMessages(rows));
}

/**
 * Conversación real: los últimos hasta 10 entrantes de las últimas 24h, SIN
 * recortar por "desde el último saliente". Un mensaje que llega mientras el
 * despacho anterior seguía en vuelo con "desde el último saliente" se perdía
 * — nunca aparecía en ningún despacho porque para cuando Nea contestaba (y
 * quedaba un saliente), ese entrante ya había quedado ANTES del corte de la
 * siguiente selección. Mandar siempre la ventana completa (con su
 * `wa_message_id`) y dejar que Nea dedupee por id es lo que garantiza que
 * todo mensaje aparezca en al menos un despacho.
 */
async function neaRecentInboundMessages(
  db: Db,
  conversationId: string
): Promise<NeaSourceMessage[]> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const rows = await db
    .select({
      id: schema.message.id,
      waMessageId: schema.message.waMessageId,
      direction: schema.message.direction,
      type: schema.message.type,
      text: schema.message.text,
      waTimestamp: schema.message.waTimestamp,
      createdAt: schema.message.createdAt,
      mediaWaId: schema.mediaAsset.waMediaId,
    })
    .from(schema.message)
    .leftJoin(schema.mediaAsset, eq(schema.message.mediaAssetId, schema.mediaAsset.id))
    .where(
      and(
        eq(schema.message.conversationId, conversationId),
        eq(schema.message.direction, "in"),
        gte(schema.message.createdAt, since)
      )
    )
    .orderBy(desc(schema.message.createdAt))
    .limit(10);
  rows.reverse();
  return toNeaSourceMessages(rows);
}

type Conversation = typeof schema.conversation.$inferSelect;

/** Entrega la respuesta: envío real o persistencia sandbox (is_test). */
async function deliverReply(
  conversation: Conversation,
  text: string
): Promise<void> {
  if (conversation.isTest) {
    await persistTestOutbound(conversation, text);
    return;
  }
  try {
    await sendText({
      conversationId: conversation.id,
      organizationId: conversation.organizationId,
      text,
      aiGenerated: true,
    });
  } catch (err) {
    if (err instanceof SendError && err.code === "ai_disabled") return;
    if (err instanceof SendError && err.code === "billing_inactive") return;
    if (err instanceof SendError && err.code === "outside_hours") return;
    if (err instanceof SendError && err.code === "window_closed") {
      await applyHandoff(conversation.id, conversation.organizationId, "ventana");
      return;
    }
    throw err;
  }
}

/**
 * Mensaje saliente del sandbox: se persiste, JAMÁS toca la API (FR-031).
 * Exportado porque `/api/bot/messages` reusa exactamente este camino cuando
 * el cerebro externo (Nea) contesta una conversación de prueba — el mismo
 * guardarraíl vale sin importar quién redactó el texto.
 */
export async function persistTestOutbound(
  conversation: Pick<Conversation, "id" | "organizationId">,
  text: string
): Promise<{ messageId: string }> {
  const db = getDb();
  const id = newId("message");
  await db.insert(schema.message).values({
    id,
    organizationId: conversation.organizationId,
    conversationId: conversation.id,
    direction: "out",
    type: "text",
    text,
    status: "sent",
    aiGenerated: true,
    origin: "ai",
  });
  await db
    .update(schema.conversation)
    .set({ lastMessageAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.conversation.id, conversation.id));
  return { messageId: id };
}

export async function applyHandoff(
  conversationId: string,
  organizationId: string,
  reason: "cliente" | "modelo" | "error" | "ventana" | "hostilidad"
): Promise<void> {
  const db = getDb();
  const updated = await db
    .update(schema.conversation)
    .set({ handoffAt: new Date(), handoffReason: reason, updatedAt: new Date() })
    .where(eq(schema.conversation.id, conversationId))
    .returning();
  if (!updated[0]) return;
  publish(organizationId, {
    type: "conversation.updated",
    data: {
      conversation: { id: conversationId, handoffReason: reason },
    },
  });
}

async function moveLeadToStage(
  organizationId: string,
  contactId: string,
  stageId: string
): Promise<void> {
  const db = getDb();
  const rows = await db
    .select({ id: schema.lead.id })
    .from(schema.lead)
    .where(
      scoped(
        schema.lead.organizationId,
        organizationId,
        eq(schema.lead.contactId, contactId)
      )
    )
    .limit(1);
  const leadId = rows[0]?.id;
  if (!leadId) return;

  // Por la puerta única: el agente mueve tarjetas igual que el dueño, y su
  // movimiento tiene que quedar en la bitácora o el embudo mentirá sobre
  // quién hizo avanzar cada lead.
  await moveLeadThroughHistory({
    organizationId,
    leadId,
    toStageId: stageId,
    source: "bot",
    extra: { lastActivityAt: new Date() },
    // El agente no clasifica pérdidas: si su etapa destino resultara ser la
    // perdida, la puerta lo rechaza y el lead se queda donde está — mejor eso
    // que un motivo inventado.
  });
}

async function appendLeadNote(
  organizationId: string,
  contactId: string,
  note: string
): Promise<void> {
  const db = getDb();
  const rows = await db
    .select({ id: schema.contact.id, notes: schema.contact.notes })
    .from(schema.contact)
    .where(eq(schema.contact.id, contactId))
    .limit(1);
  const contact = rows[0];
  if (!contact) return;
  const stamped = `[IA] ${note}`;
  await db
    .update(schema.contact)
    .set({
      notes: contact.notes ? `${contact.notes}\n${stamped}` : stamped,
      updatedAt: new Date(),
    })
    .where(eq(schema.contact.id, contact.id));
}

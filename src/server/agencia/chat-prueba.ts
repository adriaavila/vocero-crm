import { and, asc, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { checkRateLimit, refundRateLimit } from "@/lib/rate-limit";
import { runAgentTurn } from "@/server/ai/pipeline";

/**
 * Capa de agencia — «Escríbele como cliente» en Probar: el dueño le escribe a
 * su agente y ve lo que contestaría, antes de conectar WhatsApp.
 *
 * Es el mismo sandbox del Laboratorio: la conversación nace `is_test`, así que
 * el envío real lanza excepción y nada sale a WhatsApp ni cuenta para el tope
 * de la prueba gratis. El contacto es sintético y archivado (no aparece en la
 * bandeja ni suma leads). El turno es el REAL (`runAgentTurn`), con el mismo
 * conocimiento y las mismas reglas que tendrá con clientes.
 */

/** La identidad del «cliente» de prueba: una por negocio. */
export const CHAT_PRUEBA_IDENTITY = "prueba:dueno";
export const CHAT_PRUEBA_DAILY_LIMIT = 60;
export const CHAT_PRUEBA_TEXT_MAX = 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export type ChatLine = { id: string; from: "cliente" | "agente"; text: string };
export type ChatPrueba = { lines: ChatLine[]; handoff: string | null };

async function testContact(organizationId: string): Promise<string> {
  const db = getDb();
  const inserted = await db
    .insert(schema.contact)
    .values({
      id: newId("contact"),
      organizationId,
      waIdentity: CHAT_PRUEBA_IDENTITY,
      name: "Tú (prueba)",
      archivedAt: new Date(),
    })
    .onConflictDoNothing({ target: [schema.contact.organizationId, schema.contact.channel, schema.contact.waIdentity] })
    .returning({ id: schema.contact.id });
  if (inserted[0]) return inserted[0].id;
  const rows = await db
    .select({ id: schema.contact.id })
    .from(schema.contact)
    .where(and(scoped(schema.contact.organizationId, organizationId), eq(schema.contact.waIdentity, CHAT_PRUEBA_IDENTITY)))
    .limit(1);
  return rows[0]!.id;
}

async function currentConversation(organizationId: string, contactId: string) {
  const rows = await getDb()
    .select({ id: schema.conversation.id, handoffAt: schema.conversation.handoffAt, handoffReason: schema.conversation.handoffReason })
    .from(schema.conversation)
    .where(
      and(
        scoped(schema.conversation.organizationId, organizationId),
        eq(schema.conversation.contactId, contactId),
        eq(schema.conversation.isTest, true),
      ),
    )
    .orderBy(desc(schema.conversation.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

async function newConversation(organizationId: string, contactId: string): Promise<string> {
  const id = newId("conversation");
  await getDb().insert(schema.conversation).values({ id, organizationId, contactId, isTest: true, aiEnabled: true });
  return id;
}

async function read(organizationId: string, conversationId: string, handoffReason: string | null, handoffAt: Date | null): Promise<ChatPrueba> {
  const messages = await getDb()
    .select({ id: schema.message.id, direction: schema.message.direction, text: schema.message.text })
    .from(schema.message)
    .where(and(scoped(schema.message.organizationId, organizationId), eq(schema.message.conversationId, conversationId)))
    .orderBy(asc(schema.message.createdAt));
  return {
    lines: messages
      .filter((m) => m.text)
      .map((m) => ({ id: m.id, from: m.direction === "in" ? ("cliente" as const) : ("agente" as const), text: m.text! })),
    handoff: handoffAt ? (handoffReason ?? "otro") : null,
  };
}

export async function getChatPrueba(organizationId: string): Promise<ChatPrueba> {
  const contactId = await testContact(organizationId);
  const conv = await currentConversation(organizationId, contactId);
  if (!conv) return { lines: [], handoff: null };
  return read(organizationId, conv.id, conv.handoffReason, conv.handoffAt);
}

export async function resetChatPrueba(organizationId: string): Promise<ChatPrueba> {
  const contactId = await testContact(organizationId);
  await newConversation(organizationId, contactId);
  return { lines: [], handoff: null };
}

export type SendResult = { ok: true; chat: ChatPrueba } | { ok: false; status: number; code: string; message: string };

export async function sendChatPrueba(organizationId: string, text: string, now = Date.now()): Promise<SendResult> {
  // ponytail: en memoria y por proceso, como los demás topes de IA del fork.
  const key = `chat-prueba:${organizationId}`;
  if (!checkRateLimit(key, { windowMs: DAY_MS, max: CHAT_PRUEBA_DAILY_LIMIT }, now).allowed) {
    return { ok: false, status: 429, code: "rate_limited", message: "Ya probaste bastante por hoy. Mañana puedes seguir." };
  }
  const db = getDb();
  const contactId = await testContact(organizationId);
  let conv = await currentConversation(organizationId, contactId);
  // Una conversación que ya pasó a una persona no vuelve a contestar: se empieza otra.
  if (!conv || conv.handoffAt) {
    const id = await newConversation(organizationId, contactId);
    conv = { id, handoffAt: null, handoffReason: null };
  }
  const at = new Date(now);
  await db.insert(schema.message).values({
    id: newId("message"),
    organizationId,
    conversationId: conv.id,
    direction: "in",
    type: "text",
    text,
    status: "delivered",
    waTimestamp: at,
  });
  await db
    .update(schema.conversation)
    .set({ lastInboundAt: at, lastMessageAt: at, updatedAt: at })
    .where(eq(schema.conversation.id, conv.id));

  try {
    await runAgentTurn(conv.id);
  } catch {
    refundRateLimit(key);
    return { ok: false, status: 503, code: "turn_failed", message: "Tu agente no pudo contestar ahora. Prueba de nuevo en un momento." };
  }
  const after = await db
    .select({ handoffAt: schema.conversation.handoffAt, handoffReason: schema.conversation.handoffReason })
    .from(schema.conversation)
    .where(eq(schema.conversation.id, conv.id))
    .limit(1);
  return { ok: true, chat: await read(organizationId, conv.id, after[0]?.handoffReason ?? null, after[0]?.handoffAt ?? null) };
}

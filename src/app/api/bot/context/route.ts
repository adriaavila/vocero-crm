import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { apiError } from "@/lib/api";
import { requireBotKey, resolveInstanceOrg } from "@/server/bot/auth";
import { buildBotContext } from "@/server/bot/context";
import { normalizeMx } from "@/lib/meta/client";

export const dynamic = "force-dynamic";

/**
 * Contexto conversacional para un cerebro externo (solo lectura).
 * GET /api/bot/context?identity=... | ?waIdentity=... | ?conversationId=...
 *
 * `identity` es el nombre neutro (hay contactos que no son de WhatsApp).
 * `waIdentity` se mantiene aceptado y presente en la respuesta porque es
 * contrato publicado: hay cerebros externos en produccion que dependen de el.
 * No tiene fecha de retiro.
 *
 * El cuerpo lo arma `buildBotContext` (`server/bot/context.ts`) — el MISMO
 * constructor que usa el payload de despacho a Nea (dispatch v2, campo
 * `context`), para que esta ruta y ese payload no puedan divergir.
 */
export async function GET(req: Request) {
  const denied = requireBotKey(req);
  if (denied) return denied;

  const organizationId = await resolveInstanceOrg(req);
  if (!organizationId) {
    return apiError(409, "no_org", "La instancia aún no tiene organización");
  }

  const url = new URL(req.url);
  const rawIdentity =
    url.searchParams.get("identity") ?? url.searchParams.get("waIdentity");
  /**
   * Se normaliza igual que en la ingesta. Meta entrega los números mexicanos
   * con el 1 del troncal (`521…`) y el CRM los guarda sin él, así que un
   * cerebro externo que reenvíe el `from` tal cual recibía 404 en TODAS las
   * conversaciones de México — y el agente se quedaba mudo sin decir por qué.
   * Una identidad que no es de teléfono (`bsuid:…`, `ig:…`) pasa intacta.
   */
  const waIdentity = rawIdentity ? normalizeMx(rawIdentity) : null;
  const conversationId = url.searchParams.get("conversationId");
  if (!waIdentity && !conversationId) {
    return apiError(422, "invalid", "Falta identity (o waIdentity) o conversationId");
  }

  const db = getDb();
  let resolvedConversationId: string | null = conversationId;

  if (!resolvedConversationId && waIdentity) {
    const contacts = await db
      .select({ id: schema.contact.id })
      .from(schema.contact)
      .where(
        and(
          eq(schema.contact.organizationId, organizationId),
          eq(schema.contact.waIdentity, waIdentity)
        )
      )
      .limit(1);
    const contact = contacts[0];
    if (contact) {
      // La conversación del Laboratorio jamás se resuelve por identidad: ese
      // camino es para el bot de producción, que nunca debe hablarle a un
      // cliente simulado.
      const convs = await db
        .select({ id: schema.conversation.id })
        .from(schema.conversation)
        .where(
          and(
            eq(schema.conversation.organizationId, organizationId),
            eq(schema.conversation.contactId, contact.id),
            eq(schema.conversation.isTest, false)
          )
        )
        .limit(1);
      resolvedConversationId = convs[0]?.id ?? null;
    }
  }

  const context = resolvedConversationId
    ? await buildBotContext(organizationId, resolvedConversationId)
    : null;
  if (!context) {
    return apiError(404, "not_found", "Conversación no encontrada");
  }

  // El cuerpo completo (contacto, conversación, lead, agentAccess, booking,
  // adOrigen) lo arma `buildBotContext` — el MISMO constructor que usa el
  // payload de despacho a Nea. Armarlo de nuevo aquí (como hacía esta ruta
  // antes de dispatch v2) es exactamente la divergencia silenciosa que el
  // docstring de arriba dice que no debe pasar.
  return Response.json(context);
}

import { and, eq, isNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { isExternalBrainConfigured } from "@/lib/env";

/**
 * Capa de agencia — ¿la IA nace encendida en una conversación nueva?
 *
 * Upstream dice que sí, siempre: allá una instancia es de su propio dueño, que
 * la configuró él. Este fork la ponía en NO, siempre, porque aquí la instancia
 * se ENTREGA a un cliente y un agente a medio configurar contestándole a un
 * lead real es un incidente con el cliente final.
 *
 * Las dos respuestas fijas están mal, y la segunda peor: con la IA apagada en
 * cada conversación nueva y sin nada que la encienda, un cliente que YA activó
 * su agente veía a su bot callado ante todos sus leads. El cerebro externo
 * recibía `ai_paused` y se quedaba en silencio, exactamente como si estuviera
 * bien apagado. Un fallo silencioso, del peor tipo.
 *
 * La pregunta correcta no es "¿esta conversación?" sino "¿este negocio ya
 * encendió su agente?":
 *
 *   sin ningún cerebro            → NO. La instancia recién entregada calla.
 *   agente interno encendido      → SÍ. Es lo que el dueño pidió.
 *   cerebro externo conectado     → SÍ. `BOT_API_KEY` configurada significa
 *                                   que hay un bot al mando; que hable o no
 *                                   lo decide él (allowlist, calificación).
 *                                   Sin esto, una instancia con Nea al frente
 *                                   —que es el caso normal de la agencia— y
 *                                   el agente interno apagado dejaba a TODOS
 *                                   los leads sin respuesta.
 *   + activación por mensajes
 *     configurados                → NO. En ese modo solo despiertan los
 *                                   mensajes exactos que el dueño definió,
 *                                   que es para lo que existe el modo.
 *
 * La pausa manual, el handoff y la allowlist siguen mandando después: esto
 * solo decide con qué valor NACE la conversación.
 */
export async function iaInicialPara(organizationId: string): Promise<boolean> {
  const db = getDb();
  const rows = await db
    .select({
      enabled: schema.agentProfile.enabled,
      activationEnabled: schema.agentProfile.activationEnabled,
    })
    .from(schema.agentProfile)
    .where(scoped(schema.agentProfile.organizationId, organizationId))
    .limit(1);
  const perfil = rows[0];
  // Sin perfil todavía (instancia recién registrada): manda el cerebro externo.
  if (!perfil) return isExternalBrainConfigured();
  if (perfil.activationEnabled) return false;
  return perfil.enabled || isExternalBrainConfigured();
}

/**
 * Enciende la IA en las conversaciones que siguen apagadas SOLO porque
 * nacieron antes de que el dueño encendiera el agente.
 *
 * Una conversación pausada a mano o en handoff NO se toca: eso lo decidió una
 * persona, y reabrirlo por un cambio de configuración sería pisarla.
 */
export async function encenderConversacionesEnEspera(
  organizationId: string
): Promise<number> {
  const db = getDb();
  const filas = await db
    .update(schema.conversation)
    .set({ aiEnabled: true, updatedAt: new Date() })
    .where(
      scoped(
        schema.conversation.organizationId,
        organizationId,
        and(
          eq(schema.conversation.aiEnabled, false),
          // Pausada por una persona (o por handoff): no se toca. Reabrirla
          // por un cambio de configuración sería pisar una decisión humana.
          isNull(schema.conversation.handoffAt),
          eq(schema.conversation.isTest, false)
        )
      )
    )
    .returning({ id: schema.conversation.id });
  return filas.length;
}

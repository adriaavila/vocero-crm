import { scheduleAgentTurn } from "@/server/ai/pipeline";
import { isNeaBrain, shouldRunInternalAgent } from "@/lib/env";
import { isAllokSaaSMode } from "@/lib/tenant-host";

/**
 * Punto de enganche del turno del agente tras la ingesta de un mensaje
 * entrante REAL (las conversaciones del Laboratorio invocan el pipeline
 * directamente, sin debounce).
 *
 * Ya NO decide aquí si Nea o Rei contestan — eso lo decide `runAgentTurn`
 * (server/ai/pipeline.ts) dentro del propio turno. Antes, un `BOT_API_KEY`
 * configurado hacía que este punto se quedara callado (Nea escuchaba su
 * propia suscripción al webhook de Meta); ahora el CRM DESPACHA cada turno a
 * Nea, así que encolar el turno es SIEMPRE el primer paso — quedarse callado
 * aquí es exactamente el bug que dejaba a cada negocio sin nadie que le
 * conteste.
 */
export async function maybeRunAgentTurn(
  conversationId: string,
  _organizationId: string
): Promise<void> {
  if (isAllokSaaSMode()) {
    // Las claves de IA (y de Nea) pueden vivir por organización; eso solo se
    // resuelve dentro del turno, que sí conoce cuál organización es.
    await scheduleAgentTurn(conversationId);
    return;
  }
  if (!isNeaBrain() && !shouldRunInternalAgent()) return;
  await scheduleAgentTurn(conversationId);
}

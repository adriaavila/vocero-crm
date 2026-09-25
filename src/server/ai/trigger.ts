import { scheduleAgentTurn } from "@/server/ai/pipeline";
import { isNeaBrain, shouldRunInternalAgent } from "@/lib/env";
import { isAllokSaaSMode } from "@/lib/tenant-host";
import { cerebroExternoAtiende } from "@/server/agencia/cerebro-externo";

/**
 * Punto de enganche del turno del agente tras la ingesta de un mensaje
 * entrante REAL (las conversaciones del Laboratorio invocan el pipeline
 * directamente, sin debounce).
 *
 * Con Nea configurada (`isNeaBrain()`, `NEA_DISPATCH_URL` + `BOT_API_KEY`) el
 * CRM DESPACHA cada turno explícitamente por conversación — ya no importa a
 * qué número escucha Nea por su cuenta — así que encolar es SIEMPRE el primer
 * paso; `runAgentTurn` decide adentro si dispara el despacho.
 *
 * SIN `NEA_DISPATCH_URL`, el comportamiento es EXACTAMENTE el de siempre: un
 * `BOT_API_KEY` configurado sigue significando "hay un cerebro externo LEGADO
 * al mando, que escucha su PROPIA suscripción al webhook de Meta" — este
 * punto se queda callado para no responder dos veces al mismo mensaje.
 * Desplegar esta migración SIN fijar `NEA_DISPATCH_URL` es, a propósito, un
 * no-op: nada cambia para una instancia dedicada con su propio bot, ni para
 * el negocio heredado (`principal`) en SaaS.
 */
export async function maybeRunAgentTurn(
  conversationId: string,
  organizationId: string
): Promise<void> {
  if (isNeaBrain()) {
    await scheduleAgentTurn(conversationId);
    return;
  }
  if (await cerebroExternoAtiende(organizationId)) return;
  if (isAllokSaaSMode()) {
    // Las claves de IA por organización solo se resuelven dentro del turno,
    // que sí conoce cuál organización es.
    await scheduleAgentTurn(conversationId);
    return;
  }
  if (!shouldRunInternalAgent()) return;
  await scheduleAgentTurn(conversationId);
}

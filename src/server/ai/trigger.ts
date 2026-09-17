import { scheduleAgentTurn } from "@/server/ai/pipeline";
import { isExternalBrainConfigured, shouldRunInternalAgent } from "@/lib/env";
import { isAllokSaaSMode } from "@/lib/tenant-host";

/**
 * Punto de enganche del turno del agente tras la ingesta de un mensaje
 * entrante REAL (las conversaciones del Laboratorio invocan el pipeline
 * directamente, sin debounce).
 */
export async function maybeRunAgentTurn(
  conversationId: string
): Promise<void> {
  if (isExternalBrainConfigured()) return;
  // En SaaS las claves pueden vivir por organización en CRM; no podemos
  // decidir con isAiConfigured(), que solo conoce el entorno del proceso.
  if (isAllokSaaSMode()) {
    await scheduleAgentTurn(conversationId);
    return;
  }
  if (!shouldRunInternalAgent()) return;
  await scheduleAgentTurn(conversationId);
}

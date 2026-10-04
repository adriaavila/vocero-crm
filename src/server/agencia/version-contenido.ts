import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";

/**
 * Capa de agencia: marca que cambió lo que el agente dice (o con qué lo dice).
 *
 * `agent_profile.updated_at` es la versión del CONTENIDO (ver
 * `contenido-perfil.ts`): la prueba queda vieja si es anterior a ella. Quien
 * cambia el contenido por una vía que NO es el perfil la mueve aquí: borrar
 * conocimiento (nada nuevo con fecha que lo delate), cambiar la clave o el
 * modelo de IA. Pausar, encender o guardar el horario no la mueven.
 */
export async function touchAgentContent(organizationId: string): Promise<void> {
  await getDb()
    .update(schema.agentProfile)
    .set({ updatedAt: new Date() })
    .where(scoped(schema.agentProfile.organizationId, organizationId));
}

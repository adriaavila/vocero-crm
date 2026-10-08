import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { canAgentRespondNow } from "@/server/business-hours";

/**
 * Fork — nadie se queda esperando cuando termina el horario del equipo.
 *
 * En «fuera de horario» el agente calla mientras el equipo atiende: el turno
 * se pide al entrar el mensaje, el horario lo frena y no se vuelve a pedir.
 * Si el equipo no alcanzó a contestar (el cliente escribió a las 17:55, o a
 * mediodía y nadie lo vio), al cerrar el horario ese cliente seguía sin
 * respuesta hasta que volviera a escribir. Este barrido (cada minuto, en el
 * worker SaaS) le pide el turno al agente en cuanto puede contestar.
 *
 * Qué cuenta como «esperando» (todo en una sola consulta):
 *  - lo último de la conversación es del cliente, de hace más de
 *    `MIN_ESPERA` (el turno normal ya tuvo su oportunidad) y menos de
 *    `MAX_ESPERA` (más viejo, mejor que lo retome una persona, y la ventana
 *    de 24 h de WhatsApp sigue abierta);
 *  - el agente no tomó ninguna decisión desde ese mensaje (si decidió callar
 *    ante un «ok, gracias», eso queda en `agent_decision` y se respeta);
 *  - IA encendida, sin traspaso, no es del Laboratorio, sin trabajo en cola;
 *  - y la persona del equipo no venía conversando con él: si lo último
 *    antes de su mensaje fue una respuesta humana de hace menos de
 *    `CONVERSACION_HUMANA`, el agente no se mete en esa charla (lo mismo que
 *    decide la pausa manual al vencer: contestar un «ok, gracias» horas
 *    después sería peor que callar).
 *
 * Cada mensaje se intenta una sola vez por proceso (`intentados`): si el
 * turno no llega a decidir (sin modelo configurado, cupo de prueba agotado),
 * el barrido no lo reintenta cada minuto.
 */

const MIN_ESPERA_MS = 3 * 60_000;
const MAX_ESPERA_MS = 12 * 60 * 60_000;
const CONVERSACION_HUMANA_MS = 12 * 60 * 60_000;
const MAX_INTENTADOS = 5_000;

const globalForEsperando = globalThis as unknown as { __voceroEsperando?: Set<string> };
function intentados(): Set<string> {
  globalForEsperando.__voceroEsperando ??= new Set();
  return globalForEsperando.__voceroEsperando;
}

/** Solo para tests. */
export function resetClientesEsperandoForTests(): void {
  globalForEsperando.__voceroEsperando = undefined;
}

export type Esperando = { conversationId: string; organizationId: string; lastInboundAt: Date };

export async function clientesEsperando(now: Date = new Date()): Promise<Esperando[]> {
  const desde = new Date(now.getTime() - MAX_ESPERA_MS).toISOString();
  const hasta = new Date(now.getTime() - MIN_ESPERA_MS).toISOString();
  const humana = `${CONVERSACION_HUMANA_MS / 1000} seconds`;
  // El SQL crudo devuelve las fechas como texto sin zona: se pide el instante
  // en milisegundos para no depender de la zona del proceso.
  const rows = (await getDb().execute(sql`
    SELECT c.id, c.organization_id, (extract(epoch from c.last_inbound_at) * 1000)::float8 AS at_ms
    FROM conversation c
    WHERE c.is_test = false
      AND c.ai_enabled = true
      AND c.handoff_at IS NULL
      AND c.last_inbound_at > ${desde}::timestamp
      AND c.last_inbound_at <= ${hasta}::timestamp
      AND c.last_message_at <= c.last_inbound_at
      AND NOT EXISTS (
        SELECT 1 FROM agent_decision d
        WHERE d.conversation_id = c.id AND d.created_at >= c.last_inbound_at
      )
      AND NOT EXISTS (
        SELECT 1 FROM agent_job j
        WHERE j.conversation_id = c.id AND j.status IN ('queued', 'running')
      )
      AND NOT EXISTS (
        SELECT 1 FROM (
          SELECT m.direction, m.origin, m.created_at FROM message m
          WHERE m.conversation_id = c.id
            AND m.organization_id = c.organization_id
            AND m.direction = 'out'
            AND m.created_at < c.last_inbound_at
          ORDER BY m.created_at DESC
          LIMIT 1
        ) prev
        WHERE prev.origin IN ('operator', 'manual')
          AND prev.created_at > c.last_inbound_at - ${humana}::interval
      )
    -- Primero quien escribió más reciente: es quien sigue mirando el teléfono.
    ORDER BY c.last_inbound_at DESC
    LIMIT 200
  `)) as unknown as { id: string; organization_id: string; at_ms: number }[];
  return rows.map((r) => ({
    conversationId: r.id,
    organizationId: r.organization_id,
    lastInboundAt: new Date(Number(r.at_ms)),
  }));
}

/**
 * Barrido del worker: pide el turno de cada cliente esperando cuyo negocio ya
 * deja contestar al agente. Se pide igual que al entrar un mensaje
 * (`maybeRunAgentTurn`: respeta un cerebro externo propio), y las demás
 * guardas (agente encendido, facturación, cupo de prueba) las aplica el turno.
 */
export async function barrerClientesEsperando(
  schedule: (conversationId: string, organizationId: string) => Promise<void>,
  now: Date = new Date()
): Promise<number> {
  const candidatos = await clientesEsperando(now);
  if (candidatos.length === 0) return 0;
  const vistos = intentados();
  const abierto = new Map<string, boolean>();
  let total = 0;
  for (const c of candidatos) {
    const llave = `${c.conversationId}:${c.lastInboundAt.getTime()}`;
    if (vistos.has(llave)) continue;
    let puede = abierto.get(c.organizationId);
    if (puede === undefined) {
      puede = await canAgentRespondNow(c.organizationId, now);
      abierto.set(c.organizationId, puede);
    }
    if (!puede) continue;
    if (vistos.size >= MAX_INTENTADOS) vistos.clear();
    vistos.add(llave);
    await schedule(c.conversationId, c.organizationId);
    total++;
  }
  if (total > 0) console.log(`[esperando] el agente retoma ${total} cliente(s) que nadie contestó`);
  return total;
}

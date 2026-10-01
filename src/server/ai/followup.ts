import { sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { agentFollowupHours, isNeaBrain } from "@/lib/env";
import { loadNeaGateState } from "@/server/ai/pipeline";

/**
 * Seguimiento automático. Nea dejó de tener estado propio (2026-09-26) y con
 * eso se perdió el único empujón que Nea v1 mandaba tras horas de silencio
 * del lead — el CRM es quien ahora guarda TODO el estado de la conversación,
 * así que el CRM es quien ahora tiene que ser dueño del temporizador.
 *
 * `sweepFollowups` (llamada desde el poll del worker, `worker.ts`, a lo sumo
 * cada 60s) encuentra conversaciones elegibles y les encola UN `agent_job` de
 * seguimiento — nunca más de uno por conversación en toda su vida: el id es
 * determinista (`followupJobId`) y los `agent_job` nunca se borran, así que
 * su sola existencia (con cualquier status) basta para no repetirlo.
 *
 * El turno que consume ese job vive en `pipeline.ts` (`runNeaFollowupTurn`,
 * enrutado desde `runAgentTurn` por `isFollowupJobId`) — el contrato completo
 * con Nea (payload `followup: true`, `messages: []`, historial sin
 * pendientes) está documentado ahí.
 */

const FOLLOWUP_JOB_PREFIX = "ajfu_";

/** Como `claimNextJob` en `worker.ts`: una tanda chica por sweep alcanza para
 *  el volumen actual: subir esto es un cambio de una línea si hace falta. */
const FOLLOWUP_SWEEP_LIMIT = 20;

const WHATSAPP_WINDOW_MS = 24 * 60 * 60 * 1000;
/** El empujón debe salir con margen dentro de la ventana de 24h de WhatsApp:
 *  sin este colchón, un job encolado justo ahora podría no alcanzar a
 *  procesarse (o Nea a contestar) antes de que la ventana cierre. */
const FOLLOWUP_WINDOW_MARGIN_MS = 30 * 60 * 1000;

export function followupJobId(conversationId: string): string {
  return `${FOLLOWUP_JOB_PREFIX}${conversationId}`;
}

export function isFollowupJobId(id: string): boolean {
  return id.startsWith(FOLLOWUP_JOB_PREFIX);
}

type FollowupCandidate = { conversationId: string; organizationId: string };

/**
 * Encuentra hasta `FOLLOWUP_SWEEP_LIMIT` conversaciones elegibles (la de
 * `last_inbound_at` más viejo primero) y les encola el job de seguimiento.
 * No hace nada sin Nea (`isNeaBrain()`) o con `AGENT_FOLLOWUP_HOURS=0`.
 * Devuelve cuántos jobs encoló.
 *
 * Elegibilidad EN SQL (debe cumplir TODO):
 *  a. conversación real de WhatsApp, con la IA encendida y sin handoff;
 *  b. el lead calló entre `AGENT_FOLLOWUP_HOURS` horas y 23h30 atrás — ni tan
 *     pronto, ni tan tarde que el empujón ya no alcance a llegar dentro de la
 *     ventana de 24h de WhatsApp;
 *  c. el ÚLTIMO mensaje de la conversación (ignorando salientes `failed` y
 *     reservas vivas — mismo criterio que `excludingLiveReservations` en
 *     `nea-history.ts`) lo mandó el agente: si habló el lead o un humano
 *     después, no hay nada que empujar;
 *  d. nunca se le mandó un seguimiento a esta conversación (id determinista,
 *     los `agent_job` no se borran: como mucho UNO en toda su vida);
 *  e. no tiene una cita real (no `is_test`) que no esté cancelada — con una
 *     cita agendada, un empujón está de más;
 *  f. si el contacto tiene lead, su etapa sigue `open` (won/lost quedan
 *     fuera: un lead que el agente ya cerró o descartó no necesita empujón).
 *
 * Gate (g), en TS por candidato: los MISMOS gates que un turno normal
 * (`loadNeaGateState` — perfil encendido, facturación, horario en SaaS). Si
 * alguno falla, NO se encola: la conversación no queda descartada para
 * siempre, un sweep futuro la vuelve a intentar mientras la ventana siga
 * abierta.
 */
export async function sweepFollowups(now: Date = new Date()): Promise<number> {
  if (!isNeaBrain()) return 0;
  const hours = agentFollowupHours();
  if (hours <= 0) return 0;

  const silenceCutoff = new Date(now.getTime() - hours * 60 * 60 * 1000);
  const windowFloor = new Date(now.getTime() - WHATSAPP_WINDOW_MS + FOLLOWUP_WINDOW_MARGIN_MS);

  const db = getDb();
  const rows = await db.execute(sql`
    select c.id as "conversationId", c.organization_id as "organizationId"
    from conversation c
    join lateral (
      select m.direction, m.origin
      from message m
      where m.organization_id = c.organization_id
        and m.conversation_id = c.id
        and not (m.direction = 'out' and m.status = 'failed')
        and not (m.wa_message_id is null and m.status = 'pending')
      order by m.created_at desc
      limit 1
    ) last_msg on true
    where c.is_test = false
      and c.channel = 'whatsapp'
      and c.ai_enabled = true
      and c.handoff_at is null
      and c.last_inbound_at is not null
      and c.last_inbound_at <= ${silenceCutoff.toISOString()}::timestamp
      and c.last_inbound_at > ${windowFloor.toISOString()}::timestamp
      and last_msg.direction = 'out'
      and last_msg.origin = 'ai'
      and not exists (
        select 1 from agent_job aj where aj.id = ${FOLLOWUP_JOB_PREFIX} || c.id
      )
      and not exists (
        select 1 from booking bk
        where (bk.conversation_id = c.id or bk.contact_id = c.contact_id)
          and bk.is_test = false
          and bk.status <> 'cancelada'
      )
      and not exists (
        select 1
        from lead ld
        join pipeline_stage ps on ps.id = ld.stage_id
        where ld.contact_id = c.contact_id
          and ps.kind <> 'open'
      )
    order by c.last_inbound_at asc
    limit ${FOLLOWUP_SWEEP_LIMIT}
  `);
  const candidates = rows as unknown as FollowupCandidate[];

  let enqueued = 0;
  for (const candidate of candidates) {
    // Mismos gates que un turno real (perfil, facturación, horario). Si
    // alguno falla, esta conversación se salta EN ESTE sweep nada más: el
    // próximo (≤60s después, mientras la ventana de 24h siga abierta) la
    // vuelve a intentar.
    const gate = await loadNeaGateState(candidate.conversationId);
    if (!gate) continue;

    const inserted = await db
      .insert(schema.agentJob)
      .values({
        id: followupJobId(candidate.conversationId),
        organizationId: candidate.organizationId,
        conversationId: candidate.conversationId,
        availableAt: now,
      })
      // Cubre el choque contra la PK (ya existe el seguimiento de esta
      // conversación) Y contra `agent_job_active_conversation_uq` (un turno
      // normal se encoló para esta conversación entre el SELECT de arriba y
      // este INSERT) — en cualquiera de los dos casos no hay nada que hacer.
      .onConflictDoNothing()
      .returning({ id: schema.agentJob.id });
    if (inserted.length > 0) enqueued++;
  }

  if (enqueued > 0) {
    // Import dinámico: evita el ciclo estático (`worker.ts` ya importa
    // `sweepFollowups` de este archivo) — mismo motivo que el import
    // dinámico de `./worker` en `pipeline.ts`.
    void import("./worker").then(({ kickAgentWorker }) => kickAgentWorker());
  }
  return enqueued;
}

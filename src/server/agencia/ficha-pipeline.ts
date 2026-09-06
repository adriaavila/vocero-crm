import { asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { moveLeadToStage } from "@/server/leads/stage-history";
import type { Ficha } from "@/server/bot/ficha";

/**
 * Capa de agencia — el embudo se mueve solo con lo que el agente descubre.
 *
 * Upstream avanza la etapa al AGENDAR. Falta el tramo de antes: el cerebro
 * externo pasa la conversación entera calificando (`update_ficha`), y sin esto
 * el tablero del cliente se queda con todos los leads en "Nuevo" hasta que
 * alguien los arrastra a mano. Un pipeline que hay que mantener a mano es un
 * pipeline que nadie mantiene, y entonces el CRM deja de decir la verdad.
 *
 * Reglas (las del fork, ahora sobre `moveLeadToStage` para que el movimiento
 * QUEDE EN LA BITÁCORA — la versión anterior escribía la etapa a pelo y el
 * historial no se enteraba):
 *
 *   resultado = "dio_diy"                  → etapa perdida
 *   calificado = true | resultado="agendo" → última etapa abierta
 *   cualquier otro dato, estando en la 1ª  → segunda etapa abierta
 *
 * Nunca retrocede y nunca inventa etapas: si el negocio no tiene una etapa
 * perdida, un lead descartado se queda donde está.
 */

export type ResultadoMovimiento = { movido: boolean };

export async function moverEtapaPorFicha(input: {
  organizationId: string;
  contactId: string;
  patch: Ficha;
}): Promise<ResultadoMovimiento> {
  const db = getDb();

  const leads = await db
    .select({ id: schema.lead.id, stageId: schema.lead.stageId })
    .from(schema.lead)
    .where(
      scoped(
        schema.lead.organizationId,
        input.organizationId,
        eq(schema.lead.contactId, input.contactId)
      )
    )
    .limit(1);
  const lead = leads[0];
  if (!lead) return { movido: false };

  const stages = await db
    .select({
      id: schema.pipelineStage.id,
      kind: schema.pipelineStage.kind,
    })
    .from(schema.pipelineStage)
    .where(scoped(schema.pipelineStage.organizationId, input.organizationId))
    .orderBy(asc(schema.pipelineStage.position));

  const destino = etapaDestino(input.patch, stages, lead.stageId);
  if (!destino || destino === lead.stageId) return { movido: false };

  const result = await moveLeadToStage({
    organizationId: input.organizationId,
    leadId: lead.id,
    toStageId: destino,
    source: "bot",
    // Entrar a una etapa perdida EXIGE motivo. El bot no tiene uno del
    // catálogo del negocio, así que se registra el genérico: mejor un motivo
    // pobre y la bitácora completa que un movimiento que se rechaza.
    lossReason: "no_es_perfil",
    lossNote: "El agente descartó al lead durante la calificación",
    extra: { lastActivityAt: new Date() },
  });

  return { movido: result.ok && result.changed };
}

/** PURA: a qué etapa toca ir, si es que toca. Se prueba sola. */
export function etapaDestino(
  patch: Ficha,
  stages: { id: string; kind: string }[],
  etapaActual: string | null
): string | null {
  const abiertas = stages.filter((s) => s.kind === "open");
  if (abiertas.length === 0) return null;

  if (patch.resultado === "dio_diy") {
    return stages.find((s) => s.kind === "lost")?.id ?? null;
  }
  if (patch.calificado === true || patch.resultado === "agendo") {
    return abiertas.at(-1)?.id ?? null;
  }
  // Primer dato útil sobre un lead recién llegado: sale de la bandeja de
  // entrada del embudo. Después no se mueve solo: adelantarlo por cada dato
  // suelto haría que el tablero mintiera hacia el otro lado.
  if (etapaActual && etapaActual === abiertas[0]?.id && abiertas[1]) {
    return abiertas[1].id;
  }
  return null;
}

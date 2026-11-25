import { and, desc, eq, gte } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { moveLeadToStage } from "@/server/leads/stage-history";
import { pideVisita } from "@/server/agencia/accion-del-agente";

/**
 * Fork — cuando el agente le pasa una visita a una persona, el lead avanza
 * solo en el embudo.
 *
 * En Rei, SAMER pasa todas las visitas a Marcelo. Del 21 al 28-10 entraron 40
 * clientes del anuncio y los 40 quedaron en «Nuevo»: el traspaso pasaba, pero
 * el tablero no se enteraba y nadie arrastra tarjetas. `ficha-pipeline` mueve
 * el lead cuando el cerebro califica; esto cubre el momento más claro de
 * todos, el cliente que pide ir a ver la casa.
 *
 * Reglas:
 *   - Solo si el cliente pidió la visita en sus últimos mensajes (las mismas
 *     frases que hacen que la revisión de salida pase la visita a Marcelo).
 *   - Va a la etapa abierta que hable de visita («Visita por coordinar»); si
 *     el negocio no tiene una, a la última etapa abierta. No inventa etapas.
 *   - Solo avanza: nunca retrocede, nunca saca un lead ganado o perdido.
 *   - Nunca en conversaciones de prueba.
 */

type Etapa = { id: string; name: string; kind: string; position: number };

/** Cuántos mensajes recientes del cliente se miran, y hasta qué antigüedad. */
const MENSAJES = 3;
const VENTANA_MS = 24 * 60 * 60 * 1000;

const VISITA = /\bvisit/i;
/** Una etapa de visita que ya pasó o ya está fijada no es «por coordinar». */
const VISITA_POSTERIOR = /\b(agendad|confirmad|programad|realizad|hech|hizo|visit[oó]\b)/i;
const POR_COORDINAR = /\b(coordinar|por agendar|pendiente|solicit|pedid)/i;

/** PURA: la etapa a la que va un lead que pidió visita, si tiene que moverse. */
export function etapaParaVisita(stages: Etapa[], etapaActual: string | null): string | null {
  const abiertas = stages.filter((s) => s.kind === "open").sort((a, b) => a.position - b.position);
  if (abiertas.length === 0) return null;

  const deVisita = abiertas.filter((s) => VISITA.test(s.name));
  const destino =
    deVisita.find((s) => POR_COORDINAR.test(s.name)) ??
    deVisita.find((s) => !VISITA_POSTERIOR.test(s.name)) ??
    (deVisita.length === 0 ? abiertas.at(-1) : undefined);
  if (!destino) return null;

  if (etapaActual === null) return destino.id;
  const actual = abiertas.findIndex((s) => s.id === etapaActual);
  // Ganado, perdido o una etapa que ya no existe: no se toca.
  if (actual === -1) return null;
  return abiertas.findIndex((s) => s.id === destino.id) > actual ? destino.id : null;
}

/** PURA: ¿alguno de estos mensajes del cliente pide ver la propiedad? */
export function clientePidioVisita(mensajes: (string | null | undefined)[]): boolean {
  return mensajes.some((m) => Boolean(m) && pideVisita(m as string));
}

export async function moverEtapaPorVisita(input: {
  organizationId: string;
  conversationId: string;
  now?: Date;
}): Promise<{ movido: boolean }> {
  const db = getDb();
  const now = input.now ?? new Date();

  const convs = await db
    .select({ contactId: schema.conversation.contactId, isTest: schema.conversation.isTest })
    .from(schema.conversation)
    .where(
      scoped(
        schema.conversation.organizationId,
        input.organizationId,
        eq(schema.conversation.id, input.conversationId)
      )
    )
    .limit(1);
  const conv = convs[0];
  if (!conv || conv.isTest) return { movido: false };

  const entrantes = await db
    .select({ text: schema.message.text, transcript: schema.message.transcript })
    .from(schema.message)
    .where(
      and(
        scoped(schema.message.organizationId, input.organizationId),
        eq(schema.message.conversationId, input.conversationId),
        eq(schema.message.direction, "in"),
        gte(schema.message.createdAt, new Date(now.getTime() - VENTANA_MS))
      )
    )
    .orderBy(desc(schema.message.createdAt))
    .limit(MENSAJES);
  if (!clientePidioVisita(entrantes.flatMap((m) => [m.text, m.transcript]))) {
    return { movido: false };
  }

  const [leads, stages] = await Promise.all([
    db
      .select({ id: schema.lead.id, stageId: schema.lead.stageId })
      .from(schema.lead)
      .where(
        scoped(schema.lead.organizationId, input.organizationId, eq(schema.lead.contactId, conv.contactId))
      )
      .limit(1),
    db
      .select({
        id: schema.pipelineStage.id,
        name: schema.pipelineStage.name,
        kind: schema.pipelineStage.kind,
        position: schema.pipelineStage.position,
      })
      .from(schema.pipelineStage)
      .where(scoped(schema.pipelineStage.organizationId, input.organizationId)),
  ]);
  const lead = leads[0];
  if (!lead) return { movido: false };

  const destino = etapaParaVisita(stages, lead.stageId);
  if (!destino) return { movido: false };

  const result = await moveLeadToStage({
    organizationId: input.organizationId,
    leadId: lead.id,
    toStageId: destino,
    source: "bot",
    occurredAt: now,
    extra: { lastActivityAt: now },
  });
  return { movido: result.ok && result.changed };
}

/** Lo mismo, sin hacer esperar al traspaso: un fallo aquí no lo detiene. */
export function moverEtapaPorVisitaEnFondo(organizationId: string, conversationId: string): void {
  void moverEtapaPorVisita({ organizationId, conversationId }).catch((err) => {
    console.error("[visita-pipeline] no se pudo mover el lead", err instanceof Error ? err.message : err);
  });
}

import { and, eq, isNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { publish } from "@/server/events/bus";
import {
  businessHoursCloseAfter,
  getBusinessHours,
  type BusinessHoursSettings,
} from "@/server/business-hours";

/**
 * Capa de agencia (fork) — la pausa por respuesta manual VENCE.
 *
 * Cuando el dueño contesta un chat desde la app del teléfono (echo de
 * coexistencia, `ingestManualEcho`), la IA se aparta de ese chat:
 * `handoff_reason = 'manual_reply'`. Antes se apartaba PARA SIEMPRE y nada
 * la traía de vuelta salvo el botón del chat. Leído en producción el
 * 2026-10-04: en Mística 54 de 55 chats estaban así y el agente llevaba una
 * semana sin contestar un solo mensaje mientras la dueña respondía 124 a
 * mano; en el número de allok, 2.352 respuestas a mano contra 35 de la IA.
 * La promesa de la web ("nadie se queda sin respuesta") moría en el primer
 * chat que el dueño tocaba. Ahora:
 *
 *   - `handoff_at` es la ÚLTIMA respuesta manual: cada echo adelanta el reloj
 *     (nunca lo atrasa: GREATEST, por si Meta entrega echoes desordenados).
 *   - La pausa vence `agent_profile.handoff_resume_hours` después (null =
 *     12 h, `DEFAULT_HANDOFF_RESUME_HOURS`; 0 = nunca, la reactiva el dueño).
 *   - Si el agente atiende solo fuera de horario, también vence en cuanto
 *     empieza su turno: una pausa de media tarde no puede dejar la noche sin
 *     respuesta, que es justo lo que ese modo promete cubrir.
 *   - Los traspasos del agente (`cliente`, `modelo`, `error`, `ventana`,
 *     `hostilidad`) NO vencen: ahí alguien pidió una persona.
 *   - Las pausas anteriores al deploy (migración 9015) quedan sin reloj
 *     (`handoff_at` NULL): no vencen hasta que el dueño vuelva a contestar
 *     ese chat, y desde esa respuesta aplica la regla nueva.
 *   - Un chat que el dueño apagó a propósito (toggle, `ai_enabled=false` sin
 *     traspaso) no se marca al contestar: no había IA que apartar, y marcarlo
 *     haría que "venciera" y se encendiera sola contra su decisión.
 *
 * Se reanuda en dos sitios: al entrar un mensaje del cliente (vale para toda
 * instancia, también las dedicadas sin worker, donde Nea pide el contexto
 * DESPUÉS de reenviar el webhook) y en el barrido del worker SaaS, para que
 * la bandeja y el estado de Inicio digan la verdad aunque nadie escriba.
 */

export const DEFAULT_HANDOFF_RESUME_HOURS = 12;
/**
 * El turno del agente no arranca encima de una respuesta recién escrita: una
 * respuesta a las 17:59 con cierre a las 18:00 no puede terminar con la IA
 * contestando a las 18:00 ("mientras escribes, no interrumpe").
 */
export const SHIFT_GRACE_MS = 60 * 60_000;

type PausaConv = { handoffAt: Date | string | null; handoffReason: string | null };

export function resumeHours(settings: Pick<BusinessHoursSettings, "handoffResumeHours">): number {
  const v = settings.handoffResumeHours;
  return v === null || v === undefined ? DEFAULT_HANDOFF_RESUME_HOURS : v;
}

export type Reanudacion = { at: Date; by: "hours" | "shift" } | null;

/**
 * Cuándo y por qué vuelve la IA en una pausa manual: lo primero que ocurra
 * entre las horas del negocio (`handoff_at` + N h) y, si el agente atiende
 * solo fuera de horario y la pausa nació dentro del horario del equipo, el
 * cierre de ese horario (con una hora de gracia desde la última respuesta).
 * Un instante fijo: una vez pasado, la pausa está vencida aunque el horario
 * vuelva a abrir después. null si no es una pausa manual o es "nunca".
 */
export function manualPauseResume(c: PausaConv, settings: BusinessHoursSettings): Reanudacion {
  if (c.handoffReason !== "manual_reply" || !c.handoffAt) return null;
  const hours = resumeHours(settings);
  if (hours <= 0) return null;
  const since = new Date(c.handoffAt);
  const byHours = new Date(since.getTime() + hours * 3_600_000);
  if (settings.responseMode !== "outside_hours") return { at: byHours, by: "hours" };
  const close = businessHoursCloseAfter(settings, since);
  if (!close) return { at: byHours, by: "hours" };
  const byShift = new Date(Math.max(close.getTime(), since.getTime() + SHIFT_GRACE_MS));
  return byShift.getTime() < byHours.getTime() ? { at: byShift, by: "shift" } : { at: byHours, by: "hours" };
}

/** Cuándo vence la pausa; null si no es una pausa manual o nunca vence. */
export function manualPauseResumeAt(c: PausaConv, settings: BusinessHoursSettings): Date | null {
  return manualPauseResume(c, settings)?.at ?? null;
}

export function manualPauseExpired(
  c: PausaConv,
  settings: BusinessHoursSettings,
  now: Date = new Date()
): boolean {
  const resume = manualPauseResume(c, settings);
  return resume !== null && now.getTime() >= resume.at.getTime();
}

/** Lo que la bandeja le dice al dueño (ConversationDto): cuándo vuelve la IA y por qué. */
export function pausaInfo(
  c: PausaConv,
  settings: BusinessHoursSettings
): { aiResumeAt: string | null; aiResumeBy: "hours" | "shift" | null } {
  const resume = manualPauseResume(c, settings);
  return { aiResumeAt: resume?.at.toISOString() ?? null, aiResumeBy: resume?.by ?? null };
}

/**
 * El dueño contestó a mano a las `at`: si la IA estaba encendida, se aparta
 * y anota cuándo; si ya estaba apartada por lo mismo, solo adelanta el reloj.
 */
export async function pausarPorRespuestaManual(
  conversationId: string,
  at: Date
): Promise<"paused" | "extended" | "none"> {
  const db = getDb();
  const paused = await db
    .update(schema.conversation)
    .set({ aiEnabled: false, handoffAt: at, handoffReason: "manual_reply", updatedAt: new Date() })
    .where(
      and(
        eq(schema.conversation.id, conversationId),
        isNull(schema.conversation.handoffAt),
        eq(schema.conversation.aiEnabled, true)
      )
    )
    .returning({ id: schema.conversation.id });
  if (paused[0]) return "paused";
  return (await extenderPausaManual(conversationId, at)) ? "extended" : "none";
}

/**
 * El dueño sigue escribiendo en un chat que ya tomó (desde el teléfono o
 * desde la bandeja): el reloj de la pausa se adelanta. Nunca pausa por sí
 * solo, y nunca lo atrasa. El instante va como texto con cast explícito:
 * postgres-js no serializa un Date crudo dentro de un `sql` (history-sync).
 */
export async function extenderPausaManual(conversationId: string, at: Date): Promise<boolean> {
  const extended = await getDb()
    .update(schema.conversation)
    .set({
      handoffAt: sql`GREATEST(${schema.conversation.handoffAt}, ${at.toISOString()}::timestamp)`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.conversation.id, conversationId),
        eq(schema.conversation.handoffReason, "manual_reply")
      )
    )
    .returning({ id: schema.conversation.id });
  return Boolean(extended[0]);
}

type PausaVista = { id: string; handoffAt: Date | string };

/**
 * Reanuda las pausas que se LEYERON vencidas. La guarda compara contra el
 * `handoff_at` que se leyó (truncado a milisegundos, que es lo que un Date de
 * JS conserva): si entre la lectura y este UPDATE el dueño volvió a escribir
 * (el echo adelantó el reloj) o la reactivó/apagó él, la fila ya no coincide y
 * no se pisa. Una fila por UPDATE: son pocas y cada una tiene su instante.
 */
async function reanudar(vistas: PausaVista[], organizationId: string): Promise<number> {
  if (vistas.length === 0) return 0;
  const db = getDb();
  let total = 0;
  for (const vista of vistas) {
    const leido = new Date(vista.handoffAt).toISOString();
    const rows = await db
      .update(schema.conversation)
      .set({ aiEnabled: true, handoffAt: null, handoffReason: null, updatedAt: new Date() })
      .where(
        and(
          eq(schema.conversation.id, vista.id),
          eq(schema.conversation.organizationId, organizationId),
          eq(schema.conversation.handoffReason, "manual_reply"),
          sql`date_trunc('milliseconds', ${schema.conversation.handoffAt}) <= ${leido}::timestamp`
        )
      )
      .returning({ id: schema.conversation.id });
    for (const r of rows) {
      total++;
      console.log(`[pausa] la IA retoma ${r.id}: venció la pausa por respuesta manual`);
      publish(organizationId, {
        type: "conversation.updated",
        data: { conversation: { id: r.id } },
      });
    }
  }
  return total;
}

/**
 * Si la pausa manual de ESTA lectura venció, la IA vuelve. `now` es el
 * instante que se juzga: al entrar un mensaje, el del mensaje (un entrante
 * viejo que Meta entrega tarde no abre una pausa que a su hora seguía viva).
 */
export async function reanudarSiVencio(
  conversation: PausaConv & { id: string; organizationId: string },
  now: Date = new Date()
): Promise<boolean> {
  if (conversation.handoffReason !== "manual_reply" || !conversation.handoffAt) return false;
  const settings = await getBusinessHours(conversation.organizationId);
  if (!manualPauseExpired(conversation, settings, now)) return false;
  return (
    (await reanudar([{ id: conversation.id, handoffAt: conversation.handoffAt }], conversation.organizationId)) > 0
  );
}

/**
 * Barrido del worker SaaS (cada minuto): reanuda las pausas vencidas aunque
 * el cliente no haya vuelto a escribir, para que la bandeja y el estado de
 * Inicio digan la verdad. No programa un turno: lo pendiente se contesta
 * cuando el cliente escriba de nuevo (contestar un «ok, gracias» de hace 12
 * horas sería peor que callar).
 *
 * ponytail: un bucle por negocio con filtro en JS; si algún día hay miles de
 * negocios con pausas, mover la regla por horas a un UPDATE con intervalo.
 */
export async function barrerPausasVencidas(now: Date = new Date()): Promise<number> {
  const db = getDb();
  const orgs = await db
    .selectDistinct({ organizationId: schema.conversation.organizationId })
    .from(schema.conversation)
    .where(
      and(
        eq(schema.conversation.handoffReason, "manual_reply"),
        eq(schema.conversation.isTest, false)
      )
    );
  let total = 0;
  for (const { organizationId } of orgs) {
    const settings = await getBusinessHours(organizationId);
    if (resumeHours(settings) <= 0) continue;
    const rows = await db
      .select({
        id: schema.conversation.id,
        handoffAt: schema.conversation.handoffAt,
        handoffReason: schema.conversation.handoffReason,
      })
      .from(schema.conversation)
      .where(
        and(
          eq(schema.conversation.organizationId, organizationId),
          eq(schema.conversation.handoffReason, "manual_reply"),
          eq(schema.conversation.isTest, false)
        )
      );
    const vencidas = rows
      .filter((c) => manualPauseExpired(c, settings, now))
      .map((c) => ({ id: c.id, handoffAt: c.handoffAt as Date }));
    total += await reanudar(vencidas, organizationId);
  }
  return total;
}

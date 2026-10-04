import { count, eq, gte, inArray } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import {
  systemState,
  type SystemSnapshot,
  type SystemState,
  type WhatsAppLink,
} from "@/lib/estado";
import { getPlanState } from "@/server/agencia/plan-estado";
import type { PlanState } from "@/lib/plan-estado";
import { cerebroExternoLegadoSiempreOn } from "@/server/agencia/cerebro-externo";
import { hasPaidSaaSPlanFromMetadata } from "@/server/agencia/entitlements";
import { getBusinessHours, hasConfiguredBusinessHours } from "@/server/business-hours";
import { coverage, minuteInTz, nextDay, weekdayInTz, type Span } from "@/lib/cobertura";
import { dayIsoInTz, zonedWallClockToUtc } from "@/lib/time/slots";
import { getPrioridades } from "@/server/agencia/prioridades";

/**
 * Capa de agencia (fork) — el estado de la operación con datos reales: el
 * punto del logotipo, la barra lateral, el icono de la pestaña e Inicio.
 * Las reglas viven en `lib/estado` (puras y probadas); acá solo se leen.
 */

export async function agentOn(organizationId: string): Promise<{ on: boolean; timezone: string }> {
  const rows = await getDb()
    .select({ enabled: schema.agentProfile.enabled, timezone: schema.agentProfile.businessTimezone })
    .from(schema.agentProfile)
    .where(scoped(schema.agentProfile.organizationId, organizationId))
    .limit(1);
  // Un cerebro externo LEGADO (BOT_API_KEY sin despacho) también contesta: no
  // es «apagado». Nea (con despacho) NO cuenta aquí — respeta
  // `profile.enabled` igual que Rei (ver `cerebro-externo.ts`).
  return {
    on: Boolean(rows[0]?.enabled) || (await cerebroExternoLegadoSiempreOn(organizationId)),
    timezone: rows[0]?.timezone ?? "UTC",
  };
}

export async function getSystemState(organizationId: string, owner: boolean): Promise<SystemSnapshot> {
  const db = getDb();
  const [creds, agent, jobs, plan] = await Promise.all([
    db
      .select({ status: schema.metaCredentials.status, phone: schema.metaCredentials.displayPhoneNumber })
      .from(schema.metaCredentials)
      .where(scoped(schema.metaCredentials.organizationId, organizationId))
      .limit(1),
    agentOn(organizationId),
    db
      .select({ n: count() })
      .from(schema.agentJob)
      .where(
        scoped(
          schema.agentJob.organizationId,
          organizationId,
          inArray(schema.agentJob.status, ["queued", "running"]),
        ),
      ),
    getPlanState(organizationId),
  ]);
  // El plan manda: un agente que el plan no deja contestar (prueba vencida,
  // tope de la prueba, cobro fallido) no «está respondiendo» aunque esté
  // encendido, y un cliente sin respuesta tiene que contar como espera.
  const billingActive = plan.agentAllowed;
  const agentLive = agent.on && billingActive;

  // LA regla de «esperando» es la de «Por dónde arrancar» (`prioridades.ts`):
  // el punto, la barra, el icono y el encabezado de Inicio cuentan lo mismo.
  // `light`: aquí solo importan los conteos, no el texto de las tarjetas.
  const queue = await getPrioridades(organizationId, { agentOn: agentLive, light: true, limit: 0 });
  const waiting = queue.needsYou;
  // Un turno en cola es de una conversación que ya puede estar contada como
  // viva: se toma el mayor, no la suma, para no contar dos veces la misma.
  const working = Math.max(queue.live, jobs[0]?.n ?? 0);
  const whatsapp: WhatsAppLink = creds[0] ? creds[0].status : "missing";

  return {
    ...systemState({ whatsapp, billingActive, plan: plan.kind, agentOn: agent.on, waiting, working, owner }),
    whatsapp: { status: whatsapp, phone: creds[0]?.phone ?? null },
    waiting,
    working,
  };
}

/** Una conversación de hoy en la línea del día: el minuto en que el cliente escribió por última vez. */
export type DayPoint = { id: string; contactId: string; name: string; state: SystemState; minute: number };

export type Centro = {
  timezone: string;
  /** En qué punto del plan está el negocio (prueba, cobro fallido…): Inicio lo dice y ofrece la única acción. */
  plan: PlanState;
  /** Inicio, «Hoy, hora por hora»: quién escribió y quién contesta cada minuto del día. */
  day: {
    points: DayPoint[];
    team: Span[];
    agent: Span[];
    /** A qué minuto abre el equipo mañana (null: no abre). */
    tomorrow: number | null;
    agentOn: boolean;
    /** El plan deja automatizar (`canAutomate`): sin eso el agente no contesta. */
    billingActive: boolean;
    /** Sin horario de respuesta el agente del SaaS no contesta nunca. */
    configured: boolean;
    allDay: boolean;
  };
};

function safeTimeZone(tz: string): string {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return tz;
  } catch {
    return "UTC";
  }
}

/**
 * Inicio del SaaS: la línea del día y el horario. Solo se leen las
 * conversaciones de HOY (en la zona del negocio), y el color de cada punto sale
 * de la misma regla que el punto del logotipo (`stateById`, de `prioridades`):
 * lo que no está esperando ni atendiéndose ya fue contestado.
 */
export async function getCentro(organizationId: string, stateById: Record<string, SystemState>): Promise<Centro> {
  const agent = await agentOn(organizationId);
  const tz = safeTimeZone(agent.timezone);
  const now = Date.now();
  const today = dayIsoInTz(new Date(now), tz);
  const dayStart = zonedWallClockToUtc(today, "00:00", tz) ?? new Date(now - 24 * 3_600_000);
  const [schedule, orgRows, todays, plan] = await Promise.all([
    getBusinessHours(organizationId),
    getDb()
      .select({ metadata: schema.organization.metadata })
      .from(schema.organization)
      .where(eq(schema.organization.id, organizationId))
      .limit(1),
    getDb()
      .select({
        id: schema.conversation.id,
        contactId: schema.conversation.contactId,
        name: schema.contact.name,
        lastInboundAt: schema.conversation.lastInboundAt,
      })
      .from(schema.conversation)
      .innerJoin(schema.contact, eq(schema.contact.id, schema.conversation.contactId))
      .where(
        scoped(
          schema.conversation.organizationId,
          organizationId,
          eq(schema.conversation.isTest, false),
          gte(schema.conversation.lastInboundAt, dayStart),
        ),
      ),
    getPlanState(organizationId),
  ]);

  // Un punto por conversación de hoy, en el minuto en que el cliente escribió
  // por última vez, con el color de su estado.
  const points = todays
    .filter((c) => c.lastInboundAt)
    .map((c): DayPoint => ({
      id: c.id,
      contactId: c.contactId,
      name: c.name,
      state: stateById[c.id] ?? "activo",
      minute: minuteInTz(c.lastInboundAt as Date, tz),
    }))
    .sort((a, b) => a.minute - b.minute);
  // Las mismas lecturas que los gates: canAutomate y hasSaaSPlan.
  const metadata = orgRows[0]?.metadata;
  const pro = hasPaidSaaSPlanFromMetadata(metadata, "pro");
  // «Todo el día» es de Completo: con Esencial el agente contesta fuera del horario.
  const allDay = schedule.responseMode === "all_day" && pro;
  const weekday = weekdayInTz(new Date(now), tz);
  const shifts = coverage(schedule.weeklyHours, schedule.responseMode, pro, weekday);
  const tomorrow = coverage(schedule.weeklyHours, schedule.responseMode, pro, nextDay(weekday)).team[0]?.[0] ?? null;

  return {
    timezone: tz,
    plan,
    day: {
      points,
      ...shifts,
      tomorrow,
      agentOn: agent.on,
      billingActive: plan.agentAllowed,
      configured: hasConfiguredBusinessHours(schedule),
      allDay,
    },
  };
}

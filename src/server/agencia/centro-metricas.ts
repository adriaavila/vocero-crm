import { and, eq, gte, lt, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import type { StageCount } from "@/lib/embudo";
import { addDaysISO, eachDateInRange, isValidTimeZone, todayInTz } from "@/lib/time/slots";
import { DEFAULT_TIMEZONE } from "@/server/agenda/settings";
import { businessTimezone, resolvePeriod, type ResolvedPeriod } from "@/server/analytics/period";
import { contarNuevos } from "@/server/analytics/sales";
import { PERIOD_KEYS, PERIOD_LABEL, DEFAULT_PERIOD, parsePeriod, type PeriodKey } from "@/lib/centro";

// Los periodos viven en `lib/centro` (puros, también los usa la interfaz).
export { PERIOD_KEYS, PERIOD_LABEL, DEFAULT_PERIOD, parsePeriod, type PeriodKey };

/**
 * Capa de agencia (fork) — los números de Inicio, por periodo y en la zona del
 * negocio. Cuenta lo mismo que Resultados (`analytics/*`): el periodo sale de
 * `resolvePeriod`, el Laboratorio no existe y los leads los cuenta
 * `contarNuevos`. Aquí solo se agrega lo que Resultados no tiene: conversaciones
 * con entrante por hora o por día, y quién contestó (agente o persona).
 */

const PERIOD_DAYS: Record<PeriodKey, number> = { hoy: 1, "7d": 7, "30d": 30, "90d": 90 };

/**
 * Los últimos N días que terminan HOY en la zona del negocio (hoy incluido):
 * mismo criterio de día que Resultados, así «hoy» cambia a la medianoche local.
 */
export function centroPeriod(key: PeriodKey, timezone: string, now: Date = new Date()): ResolvedPeriod {
  // `businessTimezone` ya entrega una zona válida; esto cuida a quien llame con otra.
  const tz = isValidTimeZone(timezone) ? timezone : DEFAULT_TIMEZONE;
  const to = todayInTz(now, tz);
  return resolvePeriod({ from: addDaysISO(to, -(PERIOD_DAYS[key] - 1)), to, timezone: tz, now });
}

export type SeriesPoint = { label: string; count: number };

/** Rellena con 0 los cubos sin datos: una gráfica con huecos miente sobre el ritmo. */
export function fillSeries(labels: string[], rows: { label: string; count: number }[]): SeriesPoint[] {
  const byLabel = new Map(rows.map((r) => [r.label, r.count]));
  return labels.map((label) => ({ label, count: byLabel.get(label) ?? 0 }));
}

/** La hora local («00»–«23») en la zona del negocio. */
export function currentHour(now: Date, timezone: string): string {
  const h = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hourCycle: "h23", timeZone: timezone }).format(now);
  return h.padStart(2, "0");
}

export const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));

export type CentroMetricas = {
  period: PeriodKey;
  from: string;
  to: string;
  timezone: string;
  /** `hour` en «Hoy» (24 cubos), `day` en el resto. */
  granularity: "hour" | "day";
  /** El cubo de ahora (la hora local, o el día de hoy): la gráfica lo marca. */
  current: string;
  /** Hubo algún mensaje real alguna vez: sin esto, las cifras en cero no dicen nada. */
  hasActivity: boolean;
  conversations: { total: number; series: SeriesPoint[] };
  leads: { total: number };
  /** Salientes del periodo: del agente, y de una persona (CRM + teléfono). */
  replies: { ai: number; owner: number };
};

export async function getCentroMetricas(
  organizationId: string,
  key: PeriodKey,
  now: Date = new Date(),
): Promise<CentroMetricas> {
  const db = getDb();
  const timezone = await businessTimezone(organizationId);
  const period = centroPeriod(key, timezone, now);
  const { start, end } = period;
  const hourly = key === "hoy";
  const m = schema.message;
  const c = schema.conversation;
  // `timestamp` sin zona que guarda UTC: el primer `at time zone` lo ubica y el segundo lo lleva al negocio.
  const local = sql`(${m.createdAt} at time zone 'UTC' at time zone ${timezone})`;
  const bucket = hourly ? sql<string>`to_char(${local}, 'HH24')` : sql<string>`to_char(${local}, 'YYYY-MM-DD')`;
  // Rango semiabierto [start, end): el último instante del día no se cuenta dos veces.
  // La zona viaja como parámetro: se agrupa por posición (`group by 1`); repetir la
  // expresión con otro `$n` la hace distinta para Postgres.
  // Además `c.last_message_at >= start`: una conversación con un mensaje en el rango
  // tiene su último mensaje en el rango o después, y así `conversation_org_last_idx`
  // acota la tabla en vez de recorrer todas las conversaciones del negocio.
  const range = [gte(m.createdAt, start), lt(m.createdAt, end)] as const;

  const [totals, perBucket, replies, leads, ever] = await Promise.all([
    db
      .select({ n: sql<number>`count(distinct ${m.conversationId})::int` })
      .from(m)
      .innerJoin(c, eq(c.id, m.conversationId))
      .where(scoped(m.organizationId, organizationId, eq(c.isTest, false), eq(m.direction, "in"), ...range, gte(c.lastMessageAt, start))),
    db
      .select({ label: bucket, n: sql<number>`count(distinct ${m.conversationId})::int` })
      .from(m)
      .innerJoin(c, eq(c.id, m.conversationId))
      .where(scoped(m.organizationId, organizationId, eq(c.isTest, false), eq(m.direction, "in"), ...range, gte(c.lastMessageAt, start)))
      .groupBy(sql`1`),
    db
      .select({
        ai: sql<number>`count(*) filter (where ${m.origin} = 'ai')::int`,
        owner: sql<number>`count(*) filter (where ${m.origin} in ('operator', 'manual'))::int`,
      })
      .from(m)
      .innerJoin(c, eq(c.id, m.conversationId))
      .where(
        scoped(
          m.organizationId,
          organizationId,
          eq(c.isTest, false),
          eq(m.direction, "out"),
          sql`${m.status} <> 'failed'`,
          ...range,
          gte(c.lastMessageAt, start),
        ),
      ),
    contarNuevos(organizationId, start, end),
    db
      .select({ one: sql<number>`1` })
      .from(m)
      .innerJoin(c, eq(c.id, m.conversationId))
      .where(scoped(m.organizationId, organizationId, eq(c.isTest, false)))
      .limit(1),
  ]);

  const labels = hourly ? HOURS : eachDateInRange(period.dto.from, period.dto.to);
  return {
    period: key,
    from: period.dto.from,
    to: period.dto.to,
    timezone,
    granularity: hourly ? "hour" : "day",
    current: hourly ? currentHour(now, timezone) : period.dto.to,
    hasActivity: ever.length > 0,
    conversations: {
      total: totals[0]?.n ?? 0,
      series: fillSeries(
        labels,
        perBucket.map((r) => ({ label: r.label, count: r.n })),
      ),
    },
    leads: { total: leads },
    replies: { ai: replies[0]?.ai ?? 0, owner: replies[0]?.owner ?? 0 },
  };
}

/** Los leads por etapa, ahora (no del periodo): lo que dibuja el embudo de Inicio. */
export async function pipelineNow(organizationId: string): Promise<StageCount[]> {
  const rows = await getDb()
    .select({
      id: schema.pipelineStage.id,
      name: schema.pipelineStage.name,
      kind: schema.pipelineStage.kind,
      count: sql<number>`count(${schema.lead.id})::int`,
    })
    .from(schema.pipelineStage)
    .leftJoin(
      schema.lead,
      and(eq(schema.lead.stageId, schema.pipelineStage.id), eq(schema.lead.organizationId, organizationId)),
    )
    .where(eq(schema.pipelineStage.organizationId, organizationId))
    .groupBy(schema.pipelineStage.id)
    .orderBy(schema.pipelineStage.position);
  return rows;
}

/** ¿El agente ha tomado alguna decisión en conversaciones reales? (esconde el enlace a «Cómo decidió» si no.) */
export async function hasAnyDecision(organizationId: string): Promise<boolean> {
  const rows = await getDb()
    .select({ one: sql<number>`1` })
    .from(schema.agentDecision)
    .where(scoped(schema.agentDecision.organizationId, organizationId))
    .limit(1);
  return rows.length > 0;
}

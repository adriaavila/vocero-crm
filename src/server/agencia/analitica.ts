import { and, count, eq, gte, lt, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { getSettings } from "@/server/agenda/settings";
import { getBranding } from "@/server/branding";
import { CHANNEL_ORDER, type Channel } from "@/lib/channels";
import { sumable } from "@/lib/money";

/**
 * Analítica propia del fork (capa de agencia): cero conflicto con
 * `src/server/overview.ts`, que sigue siendo el tablero de puesta en marcha.
 * Todo aquí es de solo lectura y agregado en SQL — son ventanas de hasta 90
 * días, y traer las filas a JS para sumarlas no escala igual.
 */

export const RANGOS = [7, 30, 90] as const;
export type Rango = (typeof RANGOS)[number];

export function isRango(v: unknown): v is Rango {
  return typeof v === "number" && (RANGOS as readonly number[]).includes(v);
}

/** [ahora - rango, ahora] y la ventana inmediatamente anterior del mismo largo. */
function ventanas(rango: Rango) {
  const fin = new Date();
  fin.setUTCHours(0, 0, 0, 0);
  fin.setUTCDate(fin.getUTCDate() + 1); // incluye el día de hoy completo
  const inicio = new Date(fin);
  inicio.setUTCDate(inicio.getUTCDate() - rango);
  const inicioPrevio = new Date(inicio);
  inicioPrevio.setUTCDate(inicioPrevio.getUTCDate() - rango);
  return { inicio, fin, inicioPrevio, finPrevio: inicio };
}

/** Con o sin dato: nunca null cuando lo pedido es un total; null solo cuando la tasa no aplica (0/0). */
function tasa(num: number, den: number): number | null {
  return den > 0 ? num / den : null;
}

export type AnaliticaData = {
  rango: Rango;
  moneda: string;
  ahora: {
    ventanasPorVencer: number;
  };
  conversion: {
    embudo: { nombre: string; kind: "open" | "won" | "lost"; posicion: number; leads: number }[];
    tasaCierre: { actual: number | null; previo: number | null; ganados: number; perdidos: number };
    ingreso: {
      ganadoCents: { actual: number; previo: number };
      perdidoCents: { actual: number; previo: number };
      fueraDeMoneda: number;
    };
    tiempoPorEtapa: { etapa: string; medianaHoras: number | null; muestras: number }[];
    motivosPerdida: { motivo: string; count: number }[];
  };
  agente: {
    resueltasSinHandoff: { actual: number | null; previo: number | null; total: number; sinHandoff: number };
    handoffPorMotivo: { motivo: string; count: number }[];
    citas: {
      ia: { actual: number; previo: number };
      manual: { actual: number; previo: number };
      noShowRate: number | null;
      canceladaRate: number | null;
    };
    scoreLab: { fecha: string; score: number }[];
  };
  operacion: {
    primeraRespuesta: {
      medianaMinutosIA: number | null;
      medianaMinutosOperador: number | null;
      muestrasIA: number;
      muestrasOperador: number;
    };
    volumenPorCanal: { canal: Channel; count: number }[];
    horasPico: { hora: number; count: number }[];
  };
};

export async function getAnalitica(
  organizationId: string,
  rango: Rango
): Promise<AnaliticaData> {
  const { inicio, fin, inicioPrevio, finPrevio } = ventanas(rango);
  const [branding, settings] = await Promise.all([
    getBranding(organizationId),
    getSettings(organizationId),
  ]);

  const [
    embudo,
    cierreActual,
    cierrePrevio,
    tiempoPorEtapa,
    motivosPerdida,
    actividadAgente,
    handoffPorMotivo,
    citasActual,
    citasPrevio,
    citasTasas,
    scoreLab,
    primeraRespuesta,
    volumenPorCanal,
    horasPico,
    ventanasPorVencer,
  ] = await Promise.all([
    embudoQuery(organizationId, inicio, fin),
    cierreQuery(organizationId, inicio, fin),
    cierreQuery(organizationId, inicioPrevio, finPrevio),
    tiempoPorEtapaQuery(organizationId, inicio, fin),
    motivosPerdidaQuery(organizationId, inicio, fin),
    actividadAgenteQuery(organizationId, inicio, fin),
    handoffPorMotivoQuery(organizationId, inicio, fin),
    citasPorFuenteQuery(organizationId, inicio, fin),
    citasPorFuenteQuery(organizationId, inicioPrevio, finPrevio),
    citasTasasQuery(organizationId, inicio, fin),
    scoreLabQuery(organizationId, inicio, fin),
    primeraRespuestaQuery(organizationId, inicio, fin),
    volumenPorCanalQuery(organizationId, inicio, fin),
    horasPicoQuery(organizationId, inicio, fin, settings.timezone),
    ventanasPorVencerQuery(organizationId),
  ]);

  return {
    rango,
    moneda: branding.currency,
    ahora: { ventanasPorVencer },
    conversion: {
      embudo,
      tasaCierre: {
        actual: tasa(cierreActual.ganados, cierreActual.ganados + cierreActual.perdidos),
        previo: tasa(cierrePrevio.ganados, cierrePrevio.ganados + cierrePrevio.perdidos),
        ganados: cierreActual.ganados,
        perdidos: cierreActual.perdidos,
      },
      ingreso: {
        ganadoCents: { actual: cierreActual.ganadoCents, previo: cierrePrevio.ganadoCents },
        perdidoCents: { actual: cierreActual.perdidoCents, previo: cierrePrevio.perdidoCents },
        fueraDeMoneda: cierreActual.fueraDeMoneda,
      },
      tiempoPorEtapa,
      motivosPerdida,
    },
    agente: {
      resueltasSinHandoff: {
        actual: tasa(actividadAgente.actual.sinHandoff, actividadAgente.actual.total),
        previo: tasa(actividadAgente.previo.sinHandoff, actividadAgente.previo.total),
        total: actividadAgente.actual.total,
        sinHandoff: actividadAgente.actual.sinHandoff,
      },
      handoffPorMotivo,
      citas: {
        ia: { actual: citasActual.ia, previo: citasPrevio.ia },
        manual: { actual: citasActual.manual, previo: citasPrevio.manual },
        noShowRate: tasa(citasTasas.noShow, citasTasas.total),
        canceladaRate: tasa(citasTasas.cancelada, citasTasas.total),
      },
      scoreLab,
    },
    operacion: {
      primeraRespuesta,
      volumenPorCanal,
      horasPico,
    },
  };
}

// ---------------------------------------------------------------------------
// Conversión y dinero
// ---------------------------------------------------------------------------

async function embudoQuery(organizationId: string, inicio: Date, fin: Date) {
  const db = getDb();
  const rows = await db
    .select({
      nombre: schema.pipelineStage.name,
      kind: schema.pipelineStage.kind,
      posicion: schema.pipelineStage.position,
      leads: sql<number>`count(distinct ${schema.leadStageEvent.leadId})`,
    })
    .from(schema.pipelineStage)
    .leftJoin(
      schema.leadStageEvent,
      and(
        eq(schema.leadStageEvent.toStageId, schema.pipelineStage.id),
        eq(schema.leadStageEvent.organizationId, organizationId),
        gte(schema.leadStageEvent.occurredAt, inicio),
        lt(schema.leadStageEvent.occurredAt, fin)
      )
    )
    .where(eq(schema.pipelineStage.organizationId, organizationId))
    .groupBy(schema.pipelineStage.id)
    .orderBy(schema.pipelineStage.position);
  return rows.map((r) => ({ ...r, leads: Number(r.leads) }));
}

/**
 * El cierre de un trato: el evento MÁS RECIENTE de cada lead cuyo destino es
 * won/lost dentro de la ventana. Un lead con dos eventos de cierre en la
 * misma ventana (reabierto y vuelto a cerrar) solo cuenta por el último —
 * cualquier otra cosa dobla el total.
 */
async function cierreQuery(organizationId: string, inicio: Date, fin: Date) {
  const db = getDb();
  const rows = await db.execute<{
    to_stage_kind: "won" | "lost";
    amount_cents: number | null;
    currency: string | null;
  }>(sql`
    select e.to_stage_kind, l.amount_cents, l.currency
    from lead_stage_event e
    join lead l on l.id = e.lead_id
    where e.organization_id = ${organizationId}
      and e.to_stage_kind in ('won', 'lost')
      and e.occurred_at >= ${inicio.toISOString()}
      and e.occurred_at < ${fin.toISOString()}
      and e.occurred_at = (
        select max(e2.occurred_at) from lead_stage_event e2
        where e2.lead_id = e.lead_id
          and e2.to_stage_kind in ('won', 'lost')
          and e2.occurred_at >= ${inicio.toISOString()}
          and e2.occurred_at < ${fin.toISOString()}
      )
  `);

  let ganados = 0;
  let perdidos = 0;
  let ganadoCents = 0;
  let perdidoCents = 0;
  let fueraDeMoneda = 0;
  const businessCurrency = await currencyOf(organizationId);
  for (const row of rows) {
    const monto = { amountCents: row.amount_cents, currency: row.currency };
    const cuenta = sumable(monto, businessCurrency);
    if (row.to_stage_kind === "won") {
      ganados++;
      if (cuenta && row.amount_cents !== null) ganadoCents += row.amount_cents;
      else if (row.amount_cents !== null) fueraDeMoneda++;
    } else {
      perdidos++;
      if (cuenta && row.amount_cents !== null) perdidoCents += row.amount_cents;
      else if (row.amount_cents !== null) fueraDeMoneda++;
    }
  }
  return { ganados, perdidos, ganadoCents, perdidoCents, fueraDeMoneda };
}

const currencyCache = new Map<string, string>();
async function currencyOf(organizationId: string): Promise<string> {
  const cached = currencyCache.get(organizationId);
  if (cached) return cached;
  const branding = await getBranding(organizationId);
  currencyCache.set(organizationId, branding.currency);
  return branding.currency;
}

/**
 * Cuánto dura un lead en cada etapa: diferencia con el SIGUIENTE evento del
 * mismo lead (sin importar la etapa a la que vaya). `approximate = true`
 * (fechas sembradas por una migración) entra a los totales de arriba pero
 * NUNCA aquí — mezclarlas inventaría una duración que nadie observó.
 */
async function tiempoPorEtapaQuery(organizationId: string, inicio: Date, fin: Date) {
  const db = getDb();
  const rows = await db.execute<{
    etapa: string;
    mediana_segundos: number | null;
    muestras: number;
  }>(sql`
    select
      e.to_stage_name as etapa,
      percentile_cont(0.5) within group (
        order by extract(epoch from (
          (select min(n.occurred_at) from lead_stage_event n
           where n.lead_id = e.lead_id and n.occurred_at > e.occurred_at)
          - e.occurred_at
        ))
      ) filter (where exists (
        select 1 from lead_stage_event n2
        where n2.lead_id = e.lead_id and n2.occurred_at > e.occurred_at
      )) as mediana_segundos,
      count(*) filter (where exists (
        select 1 from lead_stage_event n3
        where n3.lead_id = e.lead_id and n3.occurred_at > e.occurred_at
      )) as muestras
    from lead_stage_event e
    where e.organization_id = ${organizationId}
      and e.approximate = false
      and e.occurred_at >= ${inicio.toISOString()}
      and e.occurred_at < ${fin.toISOString()}
    group by e.to_stage_name
    order by min(e.occurred_at)
  `);
  return rows.map((r) => ({
    etapa: r.etapa,
    medianaHoras: r.mediana_segundos !== null ? Number(r.mediana_segundos) / 3600 : null,
    muestras: Number(r.muestras),
  }));
}

async function motivosPerdidaQuery(organizationId: string, inicio: Date, fin: Date) {
  const db = getDb();
  const rows = await db
    .select({
      motivo: schema.leadStageEvent.lossReason,
      count: count(),
    })
    .from(schema.leadStageEvent)
    .where(
      scoped(
        schema.leadStageEvent.organizationId,
        organizationId,
        eq(schema.leadStageEvent.toStageKind, "lost"),
        gte(schema.leadStageEvent.occurredAt, inicio),
        lt(schema.leadStageEvent.occurredAt, fin)
      )
    )
    .groupBy(schema.leadStageEvent.lossReason);
  return rows
    .filter((r) => r.motivo !== null)
    .map((r) => ({ motivo: r.motivo as string, count: Number(r.count) }));
}

// ---------------------------------------------------------------------------
// Agente IA
// ---------------------------------------------------------------------------

async function actividadAgenteVentana(organizationId: string, inicio: Date, fin: Date) {
  const db = getDb();
  const rows = await db
    .select({
      total: count(),
      sinHandoff: sql<number>`count(*) filter (where ${schema.conversation.handoffAt} is null)`,
    })
    .from(schema.conversation)
    .where(
      scoped(
        schema.conversation.organizationId,
        organizationId,
        eq(schema.conversation.isTest, false),
        gte(schema.conversation.lastMessageAt, inicio),
        lt(schema.conversation.lastMessageAt, fin)
      )
    );
  const row = rows[0];
  return { total: Number(row?.total ?? 0), sinHandoff: Number(row?.sinHandoff ?? 0) };
}

async function actividadAgenteQuery(organizationId: string, inicio: Date, fin: Date) {
  const inicioPrevio = new Date(inicio.getTime() - (fin.getTime() - inicio.getTime()));
  const [actual, previo] = await Promise.all([
    actividadAgenteVentana(organizationId, inicio, fin),
    actividadAgenteVentana(organizationId, inicioPrevio, inicio),
  ]);
  return { actual, previo };
}

async function handoffPorMotivoQuery(organizationId: string, inicio: Date, fin: Date) {
  const db = getDb();
  const rows = await db
    .select({
      motivo: schema.conversation.handoffReason,
      count: count(),
    })
    .from(schema.conversation)
    .where(
      scoped(
        schema.conversation.organizationId,
        organizationId,
        eq(schema.conversation.isTest, false),
        gte(schema.conversation.lastMessageAt, inicio),
        lt(schema.conversation.lastMessageAt, fin)
      )
    )
    .groupBy(schema.conversation.handoffReason);
  return rows
    .filter((r) => r.motivo !== null)
    .map((r) => ({ motivo: r.motivo as string, count: Number(r.count) }));
}

async function citasPorFuenteQuery(organizationId: string, inicio: Date, fin: Date) {
  const db = getDb();
  const rows = await db
    .select({
      fuente: schema.booking.source,
      count: count(),
    })
    .from(schema.booking)
    .where(
      scoped(
        schema.booking.organizationId,
        organizationId,
        eq(schema.booking.isTest, false),
        eq(schema.booking.kind, "session"),
        gte(schema.booking.createdAt, inicio),
        lt(schema.booking.createdAt, fin)
      )
    )
    .groupBy(schema.booking.source);
  let ia = 0;
  let manual = 0;
  for (const r of rows) {
    if (r.fuente === "ai") ia = Number(r.count);
    else manual = Number(r.count);
  }
  return { ia, manual };
}

async function citasTasasQuery(organizationId: string, inicio: Date, fin: Date) {
  const db = getDb();
  const rows = await db
    .select({
      total: count(),
      noShow: sql<number>`count(*) filter (where ${schema.booking.status} = 'no_show')`,
      cancelada: sql<number>`count(*) filter (where ${schema.booking.status} = 'cancelada')`,
    })
    .from(schema.booking)
    .where(
      scoped(
        schema.booking.organizationId,
        organizationId,
        eq(schema.booking.isTest, false),
        eq(schema.booking.kind, "session"),
        gte(schema.booking.createdAt, inicio),
        lt(schema.booking.createdAt, fin)
      )
    );
  const row = rows[0];
  return {
    total: Number(row?.total ?? 0),
    noShow: Number(row?.noShow ?? 0),
    cancelada: Number(row?.cancelada ?? 0),
  };
}

async function scoreLabQuery(organizationId: string, inicio: Date, fin: Date) {
  const db = getDb();
  const rows = await db
    .select({
      fecha: sql<string>`to_char(${schema.agentTestRun.finishedAt}, 'YYYY-MM-DD')`,
      score: schema.agentTestRun.score,
    })
    .from(schema.agentTestRun)
    .where(
      scoped(
        schema.agentTestRun.organizationId,
        organizationId,
        eq(schema.agentTestRun.status, "done"),
        gte(schema.agentTestRun.finishedAt, inicio),
        lt(schema.agentTestRun.finishedAt, fin)
      )
    )
    .orderBy(schema.agentTestRun.finishedAt);
  return rows
    .filter((r): r is { fecha: string; score: number } => r.score !== null)
    .map((r) => ({ fecha: r.fecha, score: r.score }));
}

// ---------------------------------------------------------------------------
// Operación y canales
// ---------------------------------------------------------------------------

/**
 * Tiempo a la primera respuesta: del primer entrante de la conversación al
 * primer saliente que le sigue. Es una foto de "qué tan rápido se contesta
 * por primera vez", no de cada turno de la conversación — medir cada turno
 * exigiría separar "sesiones" dentro del hilo, y eso es del tamaño de otra
 * feature.
 */
async function primeraRespuestaQuery(organizationId: string, inicio: Date, fin: Date) {
  const db = getDb();
  const rows = await db.execute<{
    origin: "ai" | "operator" | "manual" | "template";
    mediana_segundos: number | null;
    muestras: number;
  }>(sql`
    with primer_entrante as (
      select conversation_id, min(created_at) as t
      from message
      where organization_id = ${organizationId} and direction = 'in'
      group by conversation_id
    ),
    primera_salida as (
      select distinct on (m.conversation_id)
        m.conversation_id, m.created_at as t, m.origin
      from message m
      join primer_entrante pe on pe.conversation_id = m.conversation_id
      where m.organization_id = ${organizationId}
        and m.direction = 'out'
        and m.created_at > pe.t
      order by m.conversation_id, m.created_at asc
    )
    select
      (case when ps.origin = 'ai' then 'ai' else 'operator' end) as origin,
      percentile_cont(0.5) within group (
        order by extract(epoch from (ps.t - pe.t))
      ) as mediana_segundos,
      count(*) as muestras
    from primera_salida ps
    join primer_entrante pe on pe.conversation_id = ps.conversation_id
    join conversation c on c.id = ps.conversation_id
    where c.organization_id = ${organizationId}
      and c.is_test = false
      and pe.t >= ${inicio.toISOString()}
      and pe.t < ${fin.toISOString()}
    group by (case when ps.origin = 'ai' then 'ai' else 'operator' end)
  `);

  let medianaMinutosIA: number | null = null;
  let medianaMinutosOperador: number | null = null;
  let muestrasIA = 0;
  let muestrasOperador = 0;
  for (const r of rows) {
    const minutos = r.mediana_segundos !== null ? Number(r.mediana_segundos) / 60 : null;
    if (r.origin === "ai") {
      medianaMinutosIA = minutos;
      muestrasIA = Number(r.muestras);
    } else {
      medianaMinutosOperador = minutos;
      muestrasOperador = Number(r.muestras);
    }
  }
  return { medianaMinutosIA, medianaMinutosOperador, muestrasIA, muestrasOperador };
}

async function volumenPorCanalQuery(organizationId: string, inicio: Date, fin: Date) {
  const db = getDb();
  const rows = await db
    .select({
      canal: schema.conversation.channel,
      count: count(),
    })
    .from(schema.message)
    .innerJoin(schema.conversation, eq(schema.message.conversationId, schema.conversation.id))
    .where(
      scoped(
        schema.message.organizationId,
        organizationId,
        eq(schema.message.direction, "in"),
        eq(schema.conversation.isTest, false),
        gte(schema.message.createdAt, inicio),
        lt(schema.message.createdAt, fin)
      )
    )
    .groupBy(schema.conversation.channel);
  const byChannel = new Map(rows.map((r) => [r.canal, Number(r.count)]));
  return CHANNEL_ORDER.map((canal) => ({ canal, count: byChannel.get(canal) ?? 0 }));
}

/** Horas pico en la zona horaria del negocio (Ajustes → Agenda, con default aunque la agenda esté apagada). */
async function horasPicoQuery(organizationId: string, inicio: Date, fin: Date, timezone: string) {
  const db = getDb();
  const rows = await db.execute<{ hora: number; count: number }>(sql`
    select
      extract(hour from (m.created_at at time zone 'UTC' at time zone ${timezone})) as hora,
      count(*) as count
    from message m
    join conversation c on c.id = m.conversation_id
    where m.organization_id = ${organizationId}
      and m.direction = 'in'
      and c.is_test = false
      and m.created_at >= ${inicio.toISOString()}
      and m.created_at < ${fin.toISOString()}
    group by 1
  `);
  const byHour = new Map(rows.map((r) => [Number(r.hora), Number(r.count)]));
  return Array.from({ length: 24 }, (_, hora) => ({ hora, count: byHour.get(hora) ?? 0 }));
}

/**
 * Ventanas de WhatsApp por vencer: a menos de 4h del corte de 24h. Es una
 * alerta operativa de AHORA MISMO, no una métrica histórica — no respeta el
 * rango de fechas elegido, igual que "atención humana pendiente" en Inicio.
 */
async function ventanasPorVencerQuery(organizationId: string): Promise<number> {
  const db = getDb();
  const ahora = new Date();
  const hace20h = new Date(ahora.getTime() - 20 * 60 * 60 * 1000);
  const hace24h = new Date(ahora.getTime() - 24 * 60 * 60 * 1000);
  const rows = await db
    .select({ count: count() })
    .from(schema.conversation)
    .where(
      scoped(
        schema.conversation.organizationId,
        organizationId,
        eq(schema.conversation.isTest, false),
        eq(schema.conversation.channel, "whatsapp"),
        lt(schema.conversation.lastInboundAt, hace20h),
        gte(schema.conversation.lastInboundAt, hace24h)
      )
    );
  return Number(rows[0]?.count ?? 0);
}

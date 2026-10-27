import { desc, eq, gte, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { derivedTitle } from "@/lib/realty/catalog";
import { sugerenciasVentas, textoReporteVentas, type DatosVentas, type Formato, type Sugerencia } from "@/lib/hermes-ventas";
import { getBranding } from "@/server/branding";
import { agentOn } from "@/server/agencia/estado";
import { centroPeriod, getCentroMetricas, pipelineNow } from "@/server/agencia/centro-metricas";
import { getLoQueTrajo } from "@/server/agencia/lo-que-trajo";
import { getPrioridades } from "@/server/agencia/prioridades";
import { localStamp } from "@/server/agencia/centro-ask";

/**
 * Fork — las cifras del reporte de ventas que lee Hermes (`/api/hermes/ventas`).
 *
 * Reúne lo que ya cuenta Inicio (métricas, embudo, «Por dónde arrancar») y le
 * suma el vertical inmobiliario: cada casa con sus consultas y visitas, las
 * visitas sin resultado y lo que el agente no supo contestar. El texto y las
 * sugerencias salen de `lib/hermes-ventas.ts` (puro).
 *
 * Solo lectura. Nunca entra un teléfono: los clientes van por su nombre.
 */

export const HERMES_PERIODOS = ["7d", "30d"] as const;
export type HermesPeriodo = (typeof HERMES_PERIODOS)[number];

const DAY_MS = 86_400_000;
const DIAS: Record<HermesPeriodo, number> = { "7d": 7, "30d": 30 };
const PROXIMAS_DIAS = 7;
const SIN_RESULTADO_DIAS = 14;
const PREGUNTAS_MAX = 5;

export async function datosVentas(organizationId: string, periodo: HermesPeriodo = "7d", now: Date = new Date()): Promise<DatosVentas> {
  const db = getDb();
  const dias = DIAS[periodo];
  const [branding, agente, metricas, anterior, embudo] = await Promise.all([
    getBranding(organizationId),
    agentOn(organizationId),
    getCentroMetricas(organizationId, periodo, now),
    getCentroMetricas(organizationId, periodo, new Date(now.getTime() - dias * DAY_MS)),
    pipelineNow(organizationId),
  ]);
  const tz = metricas.timezone;
  const { start, end } = centroPeriod(periodo, tz, now);

  const bk = schema.booking;
  const bp = schema.bookingProperty;
  const pr = schema.property;
  const ct = schema.contact;
  const cv = schema.conversation;

  const [trajo, prioridades, casas, consultas, visitasPorCasa, proximas, sinResultado, resultados, listos, noSupo, pidieron, lab, fallos] =
    await Promise.all([
      getLoQueTrajo(organizationId, { start, end }, branding.currency),
      getPrioridades(organizationId, { agentOn: agente.on, now }),
      db
        .select({ id: pr.id, title: pr.title, kind: pr.kind, city: pr.city, status: pr.status, price: pr.price, currency: pr.currency })
        .from(pr)
        .where(scoped(pr.organizationId, organizationId, isNull(pr.archivedAt)))
        .orderBy(pr.title, pr.createdAt),
      // La casa que el agente estaba mostrando en cada conversación real del periodo.
      db
        .select({ propertyId: schema.conversationProperty.propertyId, n: sql<number>`count(*)::int` })
        .from(schema.conversationProperty)
        .innerJoin(cv, eq(cv.id, schema.conversationProperty.conversationId))
        .where(
          scoped(
            schema.conversationProperty.organizationId,
            organizationId,
            eq(cv.isTest, false),
            isNotNull(schema.conversationProperty.propertyId),
            gte(schema.conversationProperty.updatedAt, start),
            lt(schema.conversationProperty.updatedAt, end),
          ),
        )
        .groupBy(schema.conversationProperty.propertyId),
      db
        .select({ propertyId: bp.propertyId, n: sql<number>`count(*)::int` })
        .from(bp)
        .innerJoin(bk, eq(bk.id, bp.bookingId))
        .where(
          scoped(
            bp.organizationId,
            organizationId,
            eq(bk.isTest, false),
            sql`${bk.status} <> 'cancelada'`,
            gte(bk.scheduledAt, start),
            lt(bk.scheduledAt, end),
          ),
        )
        .groupBy(bp.propertyId),
      db
        .select({ when: bk.scheduledAt, contacto: ct.name, title: pr.title, kind: pr.kind, city: pr.city })
        .from(bk)
        .leftJoin(ct, eq(ct.id, bk.contactId))
        .leftJoin(bp, eq(bp.bookingId, bk.id))
        .leftJoin(pr, eq(pr.id, bp.propertyId))
        .where(
          scoped(
            bk.organizationId,
            organizationId,
            eq(bk.kind, "session"),
            eq(bk.isTest, false),
            eq(bk.status, "agendada"),
            gte(bk.scheduledAt, now),
            lt(bk.scheduledAt, new Date(now.getTime() + PROXIMAS_DIAS * DAY_MS)),
          ),
        )
        .orderBy(bk.scheduledAt)
        .limit(6),
      // Ya pasó, no se canceló ni faltó, y nadie dijo cómo fue.
      db
        .select({ when: bk.scheduledAt, contacto: ct.name, title: pr.title, kind: pr.kind, city: pr.city })
        .from(bp)
        .innerJoin(bk, eq(bk.id, bp.bookingId))
        .leftJoin(ct, eq(ct.id, bk.contactId))
        .innerJoin(pr, eq(pr.id, bp.propertyId))
        .where(
          scoped(
            bp.organizationId,
            organizationId,
            eq(bk.isTest, false),
            inArray(bk.status, ["agendada", "realizada"]),
            isNull(bp.outcome),
            lt(bk.scheduledAt, now),
            gte(bk.scheduledAt, new Date(now.getTime() - SIN_RESULTADO_DIAS * DAY_MS)),
          ),
        )
        .orderBy(desc(bk.scheduledAt))
        .limit(6),
      db
        .select({
          realizadas: sql<number>`count(*) filter (where ${bk.status} = 'realizada')::int`,
          noShow: sql<number>`count(*) filter (where ${bk.status} = 'no_show')::int`,
          interesados: sql<number>`count(*) filter (where ${bp.outcome} = 'interesado')::int`,
          negociar: sql<number>`count(*) filter (where ${bp.outcome} = 'quiere_negociar')::int`,
        })
        .from(bp)
        .innerJoin(bk, eq(bk.id, bp.bookingId))
        .where(scoped(bp.organizationId, organizationId, eq(bk.isTest, false), gte(bk.scheduledAt, start), lt(bk.scheduledAt, end))),
      db
        .select({ when: bk.scheduledAt, contacto: ct.name, title: pr.title, kind: pr.kind, city: pr.city })
        .from(bp)
        .innerJoin(bk, eq(bk.id, bp.bookingId))
        .leftJoin(ct, eq(ct.id, bk.contactId))
        .innerJoin(pr, eq(pr.id, bp.propertyId))
        .where(
          scoped(
            bp.organizationId,
            organizationId,
            eq(bk.isTest, false),
            inArray(bp.outcome, ["interesado", "quiere_negociar"]),
            sql`${pr.status} <> 'cerrada'`,
            gte(bk.scheduledAt, new Date(now.getTime() - SIN_RESULTADO_DIAS * DAY_MS)),
          ),
        )
        .orderBy(desc(bk.scheduledAt))
        .limit(6),
      // Lo último que escribió el cliente antes de que el agente la pasara por no saber.
      db
        .select({
          contacto: ct.name,
          pregunta: sql<string | null>`(
            select m.text from "message" m
            where m.conversation_id = ${cv.id} and m.direction = 'in' and m.text is not null
              and m.created_at <= ${cv.handoffAt}
            order by m.created_at desc limit 1
          )`,
        })
        .from(cv)
        .innerJoin(ct, eq(ct.id, cv.contactId))
        .where(
          scoped(cv.organizationId, organizationId, eq(cv.isTest, false), eq(cv.handoffReason, "modelo"), gte(cv.handoffAt, start), lt(cv.handoffAt, end)),
        )
        .orderBy(desc(cv.handoffAt))
        .limit(PREGUNTAS_MAX),
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(cv)
        .where(
          scoped(cv.organizationId, organizationId, eq(cv.isTest, false), eq(cv.handoffReason, "cliente"), gte(cv.handoffAt, start), lt(cv.handoffAt, end)),
        ),
      db
        .select({ score: schema.agentTestRun.score, at: schema.agentTestRun.finishedAt })
        .from(schema.agentTestRun)
        .where(scoped(schema.agentTestRun.organizationId, organizationId, eq(schema.agentTestRun.status, "done"), isNotNull(schema.agentTestRun.score)))
        .orderBy(desc(schema.agentTestRun.startedAt))
        .limit(1),
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.agentDecision)
        .where(
          scoped(
            schema.agentDecision.organizationId,
            organizationId,
            eq(schema.agentDecision.verdict, "fallo"),
            gte(schema.agentDecision.createdAt, start),
            lt(schema.agentDecision.createdAt, end),
          ),
        ),
    ]);

  const titulo = (r: { title: string | null; kind: string | null; city: string | null }) =>
    r.title?.trim() || (r.kind ? derivedTitle(r.kind, r.city) : null);
  const porId = (rows: { propertyId: string | null; n: number }[]) => new Map(rows.map((r) => [r.propertyId, r.n]));
  const consultasPor = porId(consultas);
  const visitasPor = porId(visitasPorCasa);
  const r = resultados[0];
  const cuando = (d: Date) => localStamp(d, tz);

  return {
    negocio: branding.name,
    zona: tz,
    desde: metricas.from,
    hasta: metricas.to,
    dias,
    agenteEncendido: agente.on,
    periodo: {
      conversaciones: metricas.conversations.total,
      leadsNuevos: metricas.leads.total,
      respondioAgente: metricas.replies.ai,
      respondieronPersonas: metricas.replies.owner,
    },
    anterior: { conversaciones: anterior.conversations.total, leadsNuevos: anterior.leads.total },
    ventas: { cerradas: trajo.ventas.count, cents: trajo.ventas.cents, moneda: trajo.currency },
    embudo: embudo.map((e) => ({ etapa: e.name, kind: e.kind, leads: e.count })),
    casas: casas.map((c) => ({
      titulo: titulo(c) ?? "Inmueble",
      estado: c.status,
      precioCents: Math.round(Number(c.price) * 100),
      moneda: c.currency,
      consultas: consultasPor.get(c.id) ?? 0,
      visitas: visitasPor.get(c.id) ?? 0,
    })),
    visitas: {
      proximas: proximas.map((v) => ({ cuando: cuando(v.when), contacto: v.contacto ?? "Sin nombre", casa: titulo(v) })),
      realizadas: r?.realizadas ?? 0,
      noShow: r?.noShow ?? 0,
      sinResultado: sinResultado.map((v) => ({ cuando: cuando(v.when), contacto: v.contacto ?? "Sin nombre", casa: titulo(v) })),
      interesados: r?.interesados ?? 0,
      quierenNegociar: r?.negociar ?? 0,
      listos: listos.map((v) => ({ cuando: cuando(v.when), contacto: v.contacto ?? "Sin nombre", casa: titulo(v) })),
    },
    teEsperan: {
      total: prioridades.needsYou,
      ventanaCerrada: prioridades.closed,
      principales: prioridades.cards
        .filter((c) => c.windowOpen && c.handler === "persona")
        .map((c) => ({ nombre: c.name, razon: c.reasonLabel, ventana: c.windowLabel })),
    },
    noSupoResponder: noSupo
      .filter((q): q is { contacto: string; pregunta: string } => Boolean(q.pregunta?.trim()))
      .map((q) => ({ contacto: q.contacto, pregunta: q.pregunta })),
    pidieronPersona: pidieron[0]?.n ?? 0,
    laboratorio: lab[0]?.score != null ? { score: lab[0].score, cuando: lab[0].at ? cuando(lab[0].at) : "" } : null,
    fallosMarcados: fallos[0]?.n ?? 0,
  };
}

export type ReporteVentas = { texto: string; sugerencias: Sugerencia[]; datos: DatosVentas };

export async function reporteVentas(
  organizationId: string,
  opts: { periodo?: HermesPeriodo; formato?: Formato; now?: Date } = {},
): Promise<ReporteVentas> {
  const datos = await datosVentas(organizationId, opts.periodo ?? "7d", opts.now ?? new Date());
  const sugerencias = sugerenciasVentas(datos);
  return { texto: textoReporteVentas(datos, sugerencias, opts.formato ?? "whatsapp"), sugerencias, datos };
}

/** `negocio` es el id de la organización o su slug (`samer`). */
export async function resolverNegocio(negocio: string): Promise<string | null> {
  const v = negocio.trim();
  if (!v || v.length > 120) return null;
  const o = schema.organization;
  const rows = await getDb()
    .select({ id: o.id })
    .from(o)
    .where(sql`${o.id} = ${v} or ${o.slug} = ${v}`)
    .limit(1);
  return rows[0]?.id ?? null;
}

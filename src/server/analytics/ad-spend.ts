import { and, desc, eq, gte, lt, lte, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { newId } from "@/lib/db/ids";
import {
  adReturn,
  moneyPerUnit,
  type AdSpendEntryDto,
  type AdSpendSourceSummaryDto,
  type AdSpendSummaryDto,
} from "@/lib/analytics";
import type { SourceValue } from "@/lib/types";
import { SOURCE_LABELS } from "@/server/contact-source";
import { daysApart, type ResolvedPeriod } from "@/server/analytics/period";
import { prospectosPorFuente } from "@/server/analytics/ads";
import { effectiveSourceExpr, notLabContact } from "@/server/analytics/shared";

/**
 * Fork — gasto de anuncios cargado a mano.
 *
 * Cloud lo tiene (Origen y anuncios: "Cargar gasto"), el raíz open source no
 * (spec 019, D1-D2: sin gasto ni costo ni retorno). No hay conector de Meta
 * Ads en el núcleo (Soberanía II) — el dueño anota lo que gastó, por fuente y
 * periodo, y de ahí se derivan costo y retorno.
 *
 * Por FUENTE, nunca por anuncio/creativo: Meta factura por conjunto o
 * campaña, no por `source_id`, y repartir un gasto de fuente entre creativos
 * sería inventar un número que nadie cargó.
 */

function toEntryDto(row: typeof schema.adSpend.$inferSelect): AdSpendEntryDto {
  return {
    id: row.id,
    source: row.source as SourceValue,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    amountCents: row.amountCents,
    currency: row.currency,
    note: row.note,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listAdSpend(organizationId: string): Promise<AdSpendEntryDto[]> {
  const rows = await getDb()
    .select()
    .from(schema.adSpend)
    .where(scoped(schema.adSpend.organizationId, organizationId))
    .orderBy(desc(schema.adSpend.periodStart), desc(schema.adSpend.createdAt));
  return rows.map(toEntryDto);
}

export async function createAdSpend(input: {
  organizationId: string;
  source: SourceValue;
  periodStart: string;
  periodEnd: string;
  amountCents: number;
  currency: string;
  note: string | null;
  createdBy: string | null;
}): Promise<AdSpendEntryDto> {
  const [row] = await getDb()
    .insert(schema.adSpend)
    .values({
      id: newId("adSpend"),
      organizationId: input.organizationId,
      source: input.source,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      amountCents: input.amountCents,
      currency: input.currency,
      note: input.note,
      createdBy: input.createdBy,
    })
    .returning();
  if (!row) throw new Error("ad_spend no se pudo insertar");
  return toEntryDto(row);
}

/** `true` si había una fila que borrar (para distinguir 404 de "ya no está"). */
export async function deleteAdSpend(
  organizationId: string,
  id: string
): Promise<boolean> {
  const deleted = await getDb()
    .delete(schema.adSpend)
    .where(scoped(schema.adSpend.organizationId, organizationId, eq(schema.adSpend.id, id)))
    .returning({ id: schema.adSpend.id });
  return deleted.length > 0;
}

/**
 * Cuántos días de traslape entre dos rangos de fecha de calendario
 * (`YYYY-MM-DD`, INCLUSIVOS en los dos extremos). Cero sin traslape.
 */
function diasDeTraslape(
  aInicio: string,
  aFin: string,
  bInicio: string,
  bFin: string
): number {
  const inicio = aInicio > bInicio ? aInicio : bInicio;
  const fin = aFin < bFin ? aFin : bFin;
  return inicio <= fin ? daysApart(inicio, fin) + 1 : 0;
}

/**
 * Prorrateo de UNA carga sobre el periodo consultado: se asume el gasto
 * repartido en partes iguales entre los días de SU rango (no hay otra
 * información — nadie carga un gasto diario), y solo cuenta la parte que cae
 * dentro del periodo que se está mirando.
 *
 * Pura y exportada para probarla sin base de datos (bordes del rango,
 * carga que empieza antes o termina después, sin traslape).
 */
export function proratedCents(
  entry: { periodStart: string; periodEnd: string; amountCents: number },
  periodFrom: string,
  periodTo: string
): number {
  const dentro = diasDeTraslape(
    entry.periodStart,
    entry.periodEnd,
    periodFrom,
    periodTo
  );
  if (dentro <= 0) return 0;
  const totalDias = daysApart(entry.periodStart, entry.periodEnd) + 1;
  return Math.round((entry.amountCents * dentro) / totalDias);
}

/**
 * ¿Algún trato ganado del periodo no tiene monto capturado? Ese trato SÍ
 * cuenta como cliente (divide el costo por cliente) pero no puede sumar al
 * retorno — nadie anotó cuánto pagó. Un solo booleano para todo el resumen:
 * alcanza para mostrar la nota, no hace falta saber cuál fuente.
 */
async function hayGanadosSinMonto(
  organizationId: string,
  start: Date,
  end: Date
): Promise<boolean> {
  const [row] = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.lead)
    .innerJoin(
      schema.pipelineStage,
      and(
        eq(schema.pipelineStage.id, schema.lead.stageId),
        eq(schema.pipelineStage.organizationId, schema.lead.organizationId)
      )
    )
    .where(
      scoped(
        schema.lead.organizationId,
        organizationId,
        gte(schema.lead.createdAt, start),
        lt(schema.lead.createdAt, end),
        eq(schema.pipelineStage.kind, "won"),
        sql`${schema.lead.amountCents} is null`,
        notLabContact(schema.lead.contactId, schema.lead.organizationId)
      )
    );
  return (row?.n ?? 0) > 0;
}

/** Dinero de tratos ganados por fuente, en la cohorte y moneda del negocio. */
async function wonCentsPorFuente(
  organizationId: string,
  start: Date,
  end: Date,
  currency: string
): Promise<Map<string, number>> {
  const rows = await getDb()
    .select({
      key: effectiveSourceExpr(
        schema.lead.organizationId,
        schema.lead.contactId,
        schema.contact.source
      ),
      wonCents: sql<number>`coalesce(sum(${schema.lead.amountCents}) filter (
        where ${schema.pipelineStage.kind} = 'won'
          and ${schema.lead.amountCents} is not null
          and coalesce(${schema.lead.currency}, ${currency}) = ${currency}
      ), 0)::bigint`,
    })
    .from(schema.lead)
    .innerJoin(
      schema.contact,
      and(
        eq(schema.contact.id, schema.lead.contactId),
        eq(schema.contact.organizationId, schema.lead.organizationId)
      )
    )
    .innerJoin(
      schema.pipelineStage,
      and(
        eq(schema.pipelineStage.id, schema.lead.stageId),
        eq(schema.pipelineStage.organizationId, schema.lead.organizationId)
      )
    )
    .where(
      scoped(
        schema.lead.organizationId,
        organizationId,
        gte(schema.lead.createdAt, start),
        lt(schema.lead.createdAt, end),
        notLabContact(schema.lead.contactId, schema.lead.organizationId)
      )
    )
    .groupBy(sql`1`);
  return new Map(rows.map((r) => [r.key ?? "desconocida", Number(r.wonCents)]));
}

/**
 * El resumen de la pantalla: gasto del periodo, costo por prospecto/cliente y
 * retorno, por fuente y en total. Solo fuentes CON gasto entran en el total
 * (spec de este fork): mezclar prospectos de una fuente sin gasto inventaría
 * un costo que nadie pagó.
 */
export async function adSpendSummary(
  organizationId: string,
  period: ResolvedPeriod,
  currency: string
): Promise<AdSpendSummaryDto> {
  const [entradas, conteos] = await Promise.all([
    getDb()
      .select()
      .from(schema.adSpend)
      .where(
        scoped(
          schema.adSpend.organizationId,
          organizationId,
          // Traslape de rangos: la carga empieza antes de que el periodo
          // termine, Y termina después de que el periodo empiece.
          lte(schema.adSpend.periodStart, period.dto.to),
          gte(schema.adSpend.periodEnd, period.dto.from)
        )
      ),
    prospectosPorFuente(organizationId, period.start, period.end),
  ]);

  const spendPorFuente = new Map<string, number>();
  let hasOtherCurrencySpend = false;
  for (const entrada of entradas) {
    if (entrada.currency !== currency) {
      // ver sumable(): no se mezclan monedas, pero no desaparece en silencio.
      hasOtherCurrencySpend = true;
      continue;
    }
    const prorrateado = proratedCents(entrada, period.dto.from, period.dto.to);
    spendPorFuente.set(
      entrada.source,
      (spendPorFuente.get(entrada.source) ?? 0) + prorrateado
    );
  }

  const fuentesConGasto = [...spendPorFuente.keys()].filter(
    (f) => (spendPorFuente.get(f) ?? 0) > 0
  );

  if (fuentesConGasto.length === 0) {
    return {
      period: period.dto,
      totalSpendCents: 0,
      costPerProspect: moneyPerUnit(0, 0),
      costPerCustomer: moneyPerUnit(0, 0),
      return: adReturn(0, 0, 0),
      bySource: [],
      empty: true,
      hasWonWithoutAmount: false,
      hasOtherCurrencySpend,
    };
  }

  const [wonCentsPorF, hasWonWithoutAmount] = await Promise.all([
    wonCentsPorFuente(organizationId, period.start, period.end, currency),
    hayGanadosSinMonto(organizationId, period.start, period.end),
  ]);
  const conteoPorFuente = new Map(conteos.map((c) => [c.key ?? "desconocida", c]));

  const bySource: AdSpendSourceSummaryDto[] = fuentesConGasto.map((fuente) => {
    const spendCents = spendPorFuente.get(fuente) ?? 0;
    const conteo = conteoPorFuente.get(fuente);
    const prospects = conteo?.leads ?? 0;
    const customers = conteo?.won ?? 0;
    const wonCents = wonCentsPorF.get(fuente) ?? 0;
    return {
      source: fuente as SourceValue,
      label: SOURCE_LABELS[fuente as SourceValue] ?? fuente,
      spendCents,
      prospects,
      costPerProspect: moneyPerUnit(spendCents, prospects),
      customers,
      costPerCustomer: moneyPerUnit(spendCents, customers),
      wonCents,
      return: adReturn(wonCents, spendCents, customers),
    };
  });

  const totalSpendCents = bySource.reduce((a, s) => a + s.spendCents, 0);
  const totalProspects = bySource.reduce((a, s) => a + s.prospects, 0);
  const totalCustomers = bySource.reduce((a, s) => a + s.customers, 0);
  const totalWonCents = bySource.reduce((a, s) => a + s.wonCents, 0);

  return {
    period: period.dto,
    totalSpendCents,
    costPerProspect: moneyPerUnit(totalSpendCents, totalProspects),
    costPerCustomer: moneyPerUnit(totalSpendCents, totalCustomers),
    return: adReturn(totalWonCents, totalSpendCents, totalCustomers),
    bySource: bySource.sort((a, b) => b.spendCents - a.spendCents),
    empty: false,
    hasWonWithoutAmount,
    hasOtherCurrencySpend,
  };
}

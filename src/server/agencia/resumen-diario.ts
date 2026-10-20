import { getDb, schema } from "@/lib/db";
import { textoResumenDia, type ResumenDia } from "@/lib/avisos";
import { horaLocal } from "@/lib/seguimiento";
import { todayInTz } from "@/lib/time/slots";
import { businessTimezone } from "@/server/analytics/period";
import { enviarAviso } from "@/server/agencia/avisos";
import { valorCitasCents } from "@/lib/lo-que-trajo";
import { getBranding } from "@/server/branding";
import { centroPeriod, getCentroMetricas } from "@/server/agencia/centro-metricas";
import { getLoQueTrajo } from "@/server/agencia/lo-que-trajo";
import { agentOn } from "@/server/agencia/estado";
import { getPrioridades } from "@/server/agencia/prioridades";

/**
 * Fork — resumen diario al celular.
 *
 * Un dueño que contrata un empleado quiere saber al final del día qué hizo.
 * Con los avisos solo se enteraba de lo que salía mal (un traspaso); lo que el
 * agente resolvía solo no lo veía nunca. A las 19:00 en la zona del negocio,
 * quien dijo «avísame» recibe una línea: cuánta plata le trajo el agente (las
 * citas por lo que vale una, más las ventas cerradas), cuántos clientes
 * escribieron y si alguien le espera.
 * Sin suscripciones no se calcula nada; un día sin clientes no se avisa.
 */

export const RESUMEN_HORA = 19;

export async function resumenDelDia(organizationId: string, now: Date): Promise<ResumenDia> {
  const [metricas, agente, branding] = await Promise.all([
    getCentroMetricas(organizationId, "hoy", now),
    agentOn(organizationId),
    getBranding(organizationId),
  ]);
  const [trajo, prioridades] = await Promise.all([
    getLoQueTrajo(organizationId, centroPeriod("hoy", metricas.timezone, now), branding.currency),
    getPrioridades(organizationId, { agentOn: agente.on, now, light: true }),
  ]);
  return {
    clientes: metricas.conversations.total,
    respuestas: metricas.replies.ai,
    citas: trajo.citas,
    teEsperan: prioridades.needsYou,
    valorCitasCents: valorCitasCents(trajo),
    ventas: trajo.ventas,
    currency: trajo.currency,
  };
}

/**
 * Reclama el día: el primero que inserta manda; un reinicio a las 19:30 o una
 * segunda instancia encuentran el renglón y no repiten.
 */
async function reclamarDia(organizationId: string, dia: string): Promise<boolean> {
  const rows = await getDb()
    .insert(schema.resumenDiario)
    .values({ organizationId, dia })
    .onConflictDoNothing()
    .returning({ dia: schema.resumenDiario.dia });
  return rows.length > 0;
}

export async function resumirNegocio(organizationId: string, now: Date = new Date()): Promise<number> {
  const timezone = await businessTimezone(organizationId);
  if (horaLocal(now, timezone) !== RESUMEN_HORA) return 0;
  const dia = todayInTz(now, timezone);
  if (!(await reclamarDia(organizationId, dia))) return 0;
  const texto = textoResumenDia(await resumenDelDia(organizationId, now));
  if (!texto) return 0;
  return enviarAviso(organizationId, { ...texto, url: "/overview", tag: `resumen-${dia}` });
}

/** Del worker, cada minuto: solo los negocios con algún teléfono suscrito. */
export async function barrerResumenesDiarios(now: Date = new Date()): Promise<number> {
  const orgs = await getDb()
    .selectDistinct({ id: schema.pushSubscription.organizationId })
    .from(schema.pushSubscription);
  let enviados = 0;
  for (const { id } of orgs) {
    try {
      enviados += await resumirNegocio(id, now);
    } catch (err) {
      console.warn("[resumen-diario]", err instanceof Error ? err.message : err);
    }
  }
  return enviados;
}

import { fuenteDeOrigen } from "@/lib/origen-alta";
import { PLAN_CATALOG } from "@/lib/saas-plans";
import type { SaaSTenantStatus } from "@/server/saas/admin";

/**
 * Capa de agencia — el embudo del SaaS para el operador: de cada canal de
 * entrada, cuántas altas, cuántas conectaron WhatsApp, cuántas encendieron el
 * agente y cuántas pagan (con su MRR). Puro: recibe la lista que ya arma
 * `listSaaSTenantStatus` y solo cuenta.
 */

export type EmbudoTenant = Pick<SaaSTenantStatus, "createdAt" | "whatsapp" | "agentEnabled" | "billing" | "origen">;

export type EmbudoConteo = {
  altas: number;
  whatsappConectado: number;
  agenteActivo: number;
  pagando: number;
  mrrUsd: number;
};

export type EmbudoFila = EmbudoConteo & { fuente: string };
export type EmbudoSemana = EmbudoConteo & { semana: string };

export type Embudo = {
  total: EmbudoConteo;
  porFuente: EmbudoFila[];
  porSemana: EmbudoSemana[];
};

/**
 * Paga de verdad: una suscripción de Stripe viva (activa o con un cobro por
 * reintentar). La prueba de autoservicio no tiene suscripción y no cuenta; una
 * prueba de Stripe (`trialing`) todavía no pagó nada.
 */
export function estaPagando(billing: EmbudoTenant["billing"]): boolean {
  return billing.subscriptionId !== null && (billing.status === "active" || billing.status === "past_due");
}

function mrrDe(tenant: EmbudoTenant): number {
  return estaPagando(tenant.billing) && tenant.billing.plan ? PLAN_CATALOG[tenant.billing.plan].priceUsd : 0;
}

function vacio(): EmbudoConteo {
  return { altas: 0, whatsappConectado: 0, agenteActivo: 0, pagando: 0, mrrUsd: 0 };
}

function sumar(conteo: EmbudoConteo, tenant: EmbudoTenant): void {
  conteo.altas += 1;
  if (tenant.whatsapp === "connected") conteo.whatsappConectado += 1;
  if (tenant.agentEnabled) conteo.agenteActivo += 1;
  if (estaPagando(tenant.billing)) conteo.pagando += 1;
  conteo.mrrUsd += mrrDe(tenant);
}

/** Semana ISO (lunes a domingo, en UTC) de una fecha: `2026-W40`. */
export function semanaIso(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dia = d.getUTCDay() || 7;
  // El jueves de esa semana decide a qué año pertenece.
  d.setUTCDate(d.getUTCDate() + 4 - dia);
  const inicioAnio = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const semana = Math.ceil(((d.getTime() - inicioAnio.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(semana).padStart(2, "0")}`;
}

/**
 * Filas por canal (más altas primero; empate, por nombre) y semanas (la más
 * nueva primero). `desde` deja fuera las altas anteriores a esa fecha.
 */
export function embudoPorFuente(tenants: readonly EmbudoTenant[], opciones: { desde?: Date } = {}): Embudo {
  const desde = opciones.desde?.getTime();
  const total = vacio();
  const porFuente = new Map<string, EmbudoConteo>();
  const porSemana = new Map<string, EmbudoConteo>();
  for (const tenant of tenants) {
    const creado = new Date(tenant.createdAt);
    if (Number.isNaN(creado.getTime())) continue;
    if (desde !== undefined && creado.getTime() < desde) continue;
    const fuente = fuenteDeOrigen(tenant.origen);
    const semana = semanaIso(creado);
    if (!porFuente.has(fuente)) porFuente.set(fuente, vacio());
    if (!porSemana.has(semana)) porSemana.set(semana, vacio());
    sumar(total, tenant);
    sumar(porFuente.get(fuente)!, tenant);
    sumar(porSemana.get(semana)!, tenant);
  }
  return {
    total,
    porFuente: [...porFuente]
      .map(([fuente, conteo]) => ({ fuente, ...conteo }))
      .sort((a, b) => b.altas - a.altas || a.fuente.localeCompare(b.fuente)),
    porSemana: [...porSemana]
      .map(([semana, conteo]) => ({ semana, ...conteo }))
      .sort((a, b) => b.semana.localeCompare(a.semana)),
  };
}

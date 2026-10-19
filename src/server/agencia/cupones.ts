import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { isSaaSPlan, soldSaaSPlans } from "@/lib/saas-plans";
import { grantSaaSPlan } from "@/server/saas/admin";
import { getOrganizationBilling, type SaaSPlan } from "@/server/saas/billing";

/**
 * Cupones de plan gratis: el dueño escribe un código y su negocio queda con
 * el plan activo, sin pasar por el checkout. Es la versión de autoservicio
 * del «Activar el plan ahora» del alta de admin, para un cliente que se da de
 * alta solo (Marcelo, de SAMER) o un piloto al que se le regala el plan.
 *
 * Los códigos viven en el entorno, no en la base: `SAAS_CUPONES` es una
 * lista separada por comas de `CODIGO:plan[:usos]`, por ejemplo
 * `SAMER:inmobiliaria:3,PILOTO:inmobiliaria`. Sin `usos`, no tiene tope. Sin
 * la variable no hay cupones y la casilla no aparece.
 *
 * El plan queda como uno concedido a mano (`grantSaaSPlan`, con auditoría) y
 * con `source = cupon:<CODIGO>`: así se cuentan los usos y un admin lo quita
 * desde el panel igual que cualquier otro.
 */

export type Cupon = { codigo: string; plan: SaaSPlan; usos: number | null };

export function normalizarCodigo(value: string): string {
  return value.trim().toUpperCase();
}

/** Pura. Una entrada mal escrita se ignora: un error de tipeo no abre un plan que nadie vende. */
export function parseCupones(raw: string | undefined, sold: SaaSPlan[]): Cupon[] {
  if (!raw?.trim()) return [];
  const cupones: Cupon[] = [];
  for (const entry of raw.split(",")) {
    const [codigoRaw = "", planRaw = "", usosRaw] = entry.split(":").map((part) => part.trim());
    const codigo = normalizarCodigo(codigoRaw);
    const plan = planRaw.toLowerCase();
    if (!/^[A-Z0-9_-]{3,40}$/.test(codigo) || !isSaaSPlan(plan) || !sold.includes(plan)) continue;
    const usos = usosRaw === undefined || usosRaw === "" ? null : Number(usosRaw);
    if (usos !== null && (!Number.isInteger(usos) || usos < 1)) continue;
    cupones.push({ codigo, plan, usos });
  }
  return cupones;
}

function cuponesActivos(): Cupon[] {
  return parseCupones(process.env.SAAS_CUPONES, soldSaaSPlans(process.env.SAAS_PLANS));
}

/** ¿Hay al menos un cupón? Decide si el registro y Facturación muestran la casilla. */
export function hayCupones(): boolean {
  return cuponesActivos().length > 0;
}

export function buscarCupon(codigo: string, cupones: Cupon[] = cuponesActivos()): Cupon | null {
  const buscado = normalizarCodigo(codigo);
  return cupones.find((cupon) => cupon.codigo === buscado) ?? null;
}

export const sourceDeCupon = (codigo: string) => `cupon:${codigo}`;

async function usosDe(codigo: string): Promise<number> {
  const rows = await getDb().execute(sql`
    select count(*)::int as n from organization
    where (metadata::jsonb #>> array['allok', 'billing', 'source']) = ${sourceDeCupon(codigo)}
  `);
  return Number((rows as unknown as { n: number }[])[0]?.n ?? 0);
}

export type CanjeResultado =
  | { ok: true; plan: SaaSPlan }
  | { ok: false; reason: "invalido" | "agotado" | "plan_activo" };

export const MENSAJE_CANJE: Record<Exclude<CanjeResultado, { ok: true }>["reason"], string> = {
  invalido: "Ese código no existe. Revisa que esté bien escrito.",
  agotado: "Ese código ya se usó todas las veces que permitía.",
  plan_activo: "Tu negocio ya tiene un plan activo.",
};

export async function canjearCupon(params: {
  organizationId: string;
  codigo: string;
  userId: string;
  email: string;
}): Promise<CanjeResultado> {
  const cupon = buscarCupon(params.codigo);
  if (!cupon) return { ok: false, reason: "invalido" };
  const billing = await getOrganizationBilling(params.organizationId);
  if (billing.plan && (billing.status === "active" || billing.status === "trialing" || billing.status === "past_due")) {
    // Una prueba de autoservicio sí se puede convertir en plan con un cupón.
    if (billing.subscriptionId || billing.status !== "trialing") return { ok: false, reason: "plan_activo" };
  }
  if (cupon.usos !== null && (await usosDe(cupon.codigo)) >= cupon.usos) {
    return { ok: false, reason: "agotado" };
  }
  const outcome = await grantSaaSPlan({
    organizationId: params.organizationId,
    plan: cupon.plan,
    adminEmail: params.email,
    adminUserId: params.userId,
    confirmOverrideStripe: false,
    source: sourceDeCupon(cupon.codigo),
  });
  if (!outcome.ok) return { ok: false, reason: "plan_activo" };
  return { ok: true, plan: cupon.plan };
}

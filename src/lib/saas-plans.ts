import type { SaaSPlan } from "@/server/saas/billing";

/**
 * Catálogo de planes SaaS: puro (sin `process.env`, sin Stripe) para que un
 * componente cliente pueda importarlo sin arrastrar `server/saas/billing.ts`
 * (que sí carga el SDK de Stripe). Solo se importa el TIPO `SaaSPlan` de ahí
 * — se borra al compilar, así que no rompe el bundle del cliente — y de aquí
 * sale todo lo demás: orden de nivel, catálogo de precios/copy y qué planes
 * vende este despliegue.
 */
export type { SaaSPlan };

/** Cada plan incluye todo lo del anterior. */
export const PLAN_ORDER: readonly SaaSPlan[] = ["basic", "pro", "inmobiliaria"];

export function isSaaSPlan(value: unknown): value is SaaSPlan {
  return typeof value === "string" && (PLAN_ORDER as readonly string[]).includes(value);
}

/** ¿Este plan alcanza o supera el umbral? `null`/`undefined` nunca alcanza nada. */
export function planMeetsTier(plan: SaaSPlan | null | undefined, threshold: SaaSPlan): boolean {
  if (!plan) return false;
  return PLAN_ORDER.indexOf(plan) >= PLAN_ORDER.indexOf(threshold);
}

export type PlanCatalogEntry = {
  id: SaaSPlan;
  name: string;
  priceUsd: number;
  tagline: string;
  features: readonly string[];
  /** Usuarios incluidos (propietario incluido). Hoy solo enforced en el equipo de Configuración. */
  seats: number;
};

/**
 * Nombre, precio, copy y cupo de usuarios de cada plan — una sola fuente
 * para toda la UI. El cupo de Agencia (10) es una suposición de producto
 * para que Adrian la confirme; Esencial/Completo mantienen el 3 de siempre.
 */
export const PLAN_CATALOG: Record<SaaSPlan, PlanCatalogEntry> = {
  basic: {
    id: "basic",
    name: "Esencial",
    priceUsd: 49,
    tagline: "Que nadie se quede sin respuesta.",
    features: [
      "Tu número de siempre, sin cambiar nada",
      "Contesta fuera de tu horario",
      "Una bandeja con toda la conversación",
      "Ficha del cliente y su historial",
    ],
    seats: 3,
  },
  pro: {
    id: "pro",
    name: "Completo",
    priceUsd: 99,
    tagline: "Cuando la consulta ya vale plata. 7 días de prueba gratis.",
    features: [
      "Todo lo de Esencial",
      "Tus ventas en etapas y agenda de citas",
      "Responde todo el día",
      "Hasta 3 usuarios",
    ],
    seats: 3,
  },
  inmobiliaria: {
    id: "inmobiliaria",
    name: "Agencia",
    priceUsd: 299,
    tagline: "Para inmobiliarias con varios asesores vendiendo a la vez.",
    features: [
      "Todo lo de Completo",
      "Pensado para equipos de asesores",
      "Hasta 10 usuarios",
      "Factura desde el día 1, sin prueba gratis",
    ],
    seats: 10,
  },
};

/**
 * `SAAS_PLANS`: lista separada por comas de los planes que vende este
 * despliegue por checkout/registro — el panel admin puede conceder
 * cualquier plan del catálogo a mano, sin importar esta variable (default
 * `basic,pro`). Pura a propósito — quien llama decide de dónde sale el
 * string (siempre `process.env.SAAS_PLANS`, y siempre del lado del
 * servidor: un componente cliente lo recibe ya resuelto por props).
 * Case-insensitive; un valor desconocido se ignora con un aviso en logs
 * (ni una `y` de más rompe el arranque).
 */
export function soldSaaSPlans(raw: string | null | undefined): SaaSPlan[] {
  const tokens = (raw ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length > 0);
  const dropped = tokens.filter((value) => !isSaaSPlan(value));
  if (dropped.length > 0) {
    console.warn(`[saas-plans] SAAS_PLANS tiene valores desconocidos, se ignoran: ${dropped.join(", ")}`);
  }
  const requested = tokens.filter(isSaaSPlan);
  const sold = PLAN_ORDER.filter((id) => requested.includes(id));
  return sold.length > 0 ? sold : ["basic", "pro"];
}

const STATUS_LABELS: Record<string, string> = {
  active: "activo",
  trialing: "en prueba",
  past_due: "pago pendiente",
  unpaid: "impago",
  canceled: "cancelado",
  incomplete: "incompleto",
  inactive: "inactivo",
};

/** Etiqueta en español de un estado de billing; cualquier valor desconocido se muestra tal cual. */
export function billingStatusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

/**
 * `manual_2026-09-15` → `Manual · 15 sep 2026`. Devuelve el string original
 * si no matchea el formato esperado, y `null` si no hay fuente.
 */
export function formatManualSource(source: string | null | undefined): string | null {
  if (!source) return null;
  const match = /^manual_(\d{4})-(\d{2})-(\d{2})$/.exec(source);
  if (!match) return source;
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (Number.isNaN(date.getTime())) return source;
  // El ICU de "short month" varía entre entornos ("sep" vs "sept."); se
  // limpia el punto para que el label sea estable donde sea que corra.
  const formatted = date
    .toLocaleDateString("es-VE", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
    .replace(/\./g, "");
  return `Manual · ${formatted}`;
}

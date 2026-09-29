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
};

/** Nombre, precio y copy de cada plan — una sola fuente para toda la UI. */
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
  },
  inmobiliaria: {
    id: "inmobiliaria",
    name: "Agencia",
    priceUsd: 299,
    tagline: "Para inmobiliarias con varios asesores vendiendo a la vez.",
    features: [
      "Todo lo de Completo",
      "Pensado para equipos de asesores",
      "Factura desde el día 1, sin prueba gratis",
    ],
  },
};

/**
 * `SAAS_PLANS`: lista separada por comas de los planes que vende este
 * despliegue (default `basic,pro`). Pura a propósito — quien llama decide de
 * dónde sale el string (siempre `process.env.SAAS_PLANS`, y siempre del lado
 * del servidor: un componente cliente lo recibe ya resuelto por props).
 */
export function soldSaaSPlans(raw: string | null | undefined): SaaSPlan[] {
  const requested = (raw ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(isSaaSPlan);
  const sold = PLAN_ORDER.filter((id) => requested.includes(id));
  return sold.length > 0 ? sold : ["basic", "pro"];
}

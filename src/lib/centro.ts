import { plural } from "@/lib/analytics";
import type { SystemSnapshot, SystemState } from "@/lib/estado";

/**
 * Capa de agencia (fork) — las frases de Inicio que dependen de los números:
 * la línea bajo el saludo y la tarjeta de estado compacta. Puro y sin servidor
 * para probarlo sin dibujar nada; el nombre de la marca llega por parámetro
 * (nunca `brand()` desde un componente cliente, ver `lib/estado`).
 */

/** Miles con punto («2.145»), igual en el servidor y en el navegador. */
export function fmtNumber(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** Qué dice el botón según adónde lleva el estado. */
export function actionLabel(snapshot: Pick<SystemSnapshot, "href" | "whatsapp">): string | null {
  switch (snapshot.href) {
    case "/settings/whatsapp":
      return snapshot.whatsapp.status === "missing" ? "Conectar WhatsApp" : "Reconectar WhatsApp";
    case "/settings/billing":
      return "Ver mi plan";
    case "/agent":
      return "Encender el agente";
    case "/inbox":
      return "Abrir conversaciones";
    default:
      return null;
  }
}

export type HomeStatus = {
  /** La línea bajo el saludo: cuántas conversaciones esperan por ti. */
  headline: { state: SystemState; text: string };
  /** La tarjeta de estado compacta: el estado del negocio, y su única acción. */
  strip: { state: SystemState; reason: string | null; href: string | null; actionLabel: string | null };
};

/**
 * Primero lo que impide funcionar (WhatsApp, el plan): eso manda en las dos.
 * Si no, la línea sale de las tarjetas de «Por dónde arrancar» — son la misma
 * fuente, así que el número de arriba y las tarjetas de abajo nunca discrepan
 * — y la tarjeta de estado dice si el agente está apagado, trabajando o todo
 * en orden.
 */
export function homeStatus(i: {
  snapshot: SystemSnapshot;
  billingActive: boolean;
  agentOn: boolean;
  /** Ventana abierta y te toca a ti. */
  needsYou: number;
  /** El agente las está contestando ahora. */
  live: number;
  /** Ventana cerrada: solo con plantilla. */
  closed: number;
  productLabel: string;
  /** Encender el agente es del propietario. */
  owner: boolean;
}): HomeStatus {
  const { snapshot, needsYou, live, closed, productLabel } = i;

  if (snapshot.whatsapp.status !== "connected" || !i.billingActive) {
    return {
      headline: { state: "atencion", text: snapshot.reason },
      strip: { state: "atencion", reason: null, href: snapshot.href, actionLabel: actionLabel(snapshot) },
    };
  }

  const tail = closed > 0 ? ` ${closed} con la ventana cerrada.` : "";
  let headline: HomeStatus["headline"];
  if (needsYou > 0) {
    headline = {
      state: "atencion",
      text: `${plural(needsYou, "1 conversación te necesita", `${needsYou} conversaciones te necesitan`)} ahora.${tail}`,
    };
  } else if (live > 0) {
    headline = {
      state: "atendiendo",
      text: `${productLabel} está respondiendo ${plural(live, "1 conversación", `${live} conversaciones`)}. Tú no tienes nada pendiente.${tail}`,
    };
  } else if (closed > 0) {
    headline = { state: "pausado", text: `Nadie espera con la ventana abierta.${tail}` };
  } else {
    headline = { state: "activo", text: "Todo al día. Nadie espera respuesta." };
  }

  // Apagado a propósito pesa más que «todo en orden», no que lo que espera.
  const off = !i.agentOn && headline.state === "activo";
  const agentOffHref = i.owner ? "/agent" : null;
  return {
    headline,
    strip: {
      state: off ? "pausado" : headline.state,
      reason: i.agentOn ? `${productLabel} contesta por ti.` : "El agente está apagado: contestas tú.",
      href: i.agentOn ? null : agentOffHref,
      actionLabel: i.agentOn ? null : agentOffHref ? "Encender el agente" : null,
    },
  };
}

export const PERIOD_KEYS = ["hoy", "7d", "30d", "90d"] as const;
export type PeriodKey = (typeof PERIOD_KEYS)[number];
export const DEFAULT_PERIOD: PeriodKey = "7d";

export const PERIOD_LABEL: Record<PeriodKey, string> = {
  hoy: "Hoy",
  "7d": "7 días",
  "30d": "30 días",
  "90d": "90 días",
};

/** `?p=` de la URL → un periodo conocido; cualquier otra cosa, el de siempre. */
export function parsePeriod(raw: string | string[] | undefined | null): PeriodKey {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return (PERIOD_KEYS as readonly string[]).includes(value ?? "") ? (value as PeriodKey) : DEFAULT_PERIOD;
}


/**
 * Capa de agencia (fork) — el estado de la operación, la idea central de la
 * marca allok: **all ok = all systems OK**. El logotipo lleva el estado en la
 * `o` (`all ● k`), así que la app tiene que saberlo de verdad: un punto verde
 * decorativo miente la primera vez que algo falla. Por eso no hay estado por
 * defecto — sale de estas reglas, sobre datos reales.
 *
 * Puro y sin servidor: lo usan el cálculo (server/agencia/estado) y la UI.
 * Espejo de los cuatro estados de allok-fun/src/lib/brand.ts.
 */

export type SystemState = "activo" | "atendiendo" | "atencion" | "pausado";

export const STATE_LABEL: Record<SystemState, string> = {
  activo: "all ok",
  atendiendo: "Atendiendo",
  atencion: "Requiere atención",
  pausado: "Pausado",
};

/**
 * El color del punto, para donde no llega el CSS (el icono de la pestaña). En
 * la página se pinta con `data-state` y los --st-* de globals.css.
 */
export const STATE_DOT: Record<SystemState, string> = {
  activo: "#20e58d",
  atendiendo: "#5b8cff",
  atencion: "#ffb020",
  pausado: "#8a9097",
};

/** Lo que el estado le dice a quien no lee leyendas (allok.fun, «El sistema»). */
export const STATE_HINT: Record<SystemState, string> = {
  activo: "Atendido solo",
  atendiendo: "Hay conversación viva",
  atencion: "Te toca a ti",
  pausado: "Apagado a propósito",
};

/** Un mensaje que entró hace menos que esto y que el agente tiene, se está atendiendo. */
export const LIVE_MS = 10 * 60_000;
/** La ventana de 24 h de WhatsApp: pasada, ya no es «alguien esperando». */
export const WINDOW_MS = 24 * 60 * 60_000;

export type ConversationSignals = {
  aiEnabled: boolean;
  handoffAt: string | Date | null;
  lastInboundAt: string | Date | null;
  lastMessageAt: string | Date | null;
  unreadCount: number;
};

const ms = (v: string | Date | null) => (v === null ? null : new Date(v).getTime());

/**
 * El estado de UNA conversación.
 *
 * - Traspasada a una persona → te toca.
 * - La última palabra fue del negocio → all ok.
 * - La última palabra es del cliente y no pasó mucho → el agente la atiende,
 *   si la tiene. Si no la tiene (o pasaron más de 10 minutos sin respuesta),
 *   y nadie la abrió, dentro de la ventana de 24 h → te toca.
 * - Sin respuesta pero ya leída, o con la ventana cerrada → quieta (gris): ni
 *   está bien ni hay nada que hacer ya desde la bandeja.
 *
 * Una conversación leída y sin responder no cuenta como pendiente a propósito:
 * el «gracias» con que cierra todo cliente dejaría la marca en ámbar para
 * siempre, y un estado que siempre avisa deja de avisar.
 */
export function conversationState(
  c: ConversationSignals,
  agentOn: boolean,
  now = Date.now(),
): SystemState {
  if (c.handoffAt) return "atencion";
  const inbound = ms(c.lastInboundAt);
  const last = ms(c.lastMessageAt);
  if (inbound === null || (last !== null && last > inbound)) return "activo";
  const age = now - inbound;
  if (agentOn && c.aiEnabled && age < LIVE_MS) return "atendiendo";
  if (c.unreadCount > 0 && age < WINDOW_MS) return "atencion";
  return "pausado";
}

/** Por qué una conversación está como está, en palabras (Inicio, «Lo último»). */
export function conversationNote(
  c: ConversationSignals,
  state: SystemState,
  now = Date.now(),
): string {
  if (state === "activo") return "Respondida";
  if (state === "atendiendo") return "allok está respondiendo";
  if (state === "atencion") return "Sin responder";
  const inbound = ms(c.lastInboundAt);
  return inbound !== null && now - inbound >= WINDOW_MS ? "Se cerró la ventana de 24 h" : "Leída, sin respuesta";
}

export type WhatsAppLink = "connected" | "reconnect_required" | "missing";

export type SystemInput = {
  whatsapp: WhatsAppLink;
  /** El plan deja automatizar (fuera del SaaS, siempre). */
  billingActive: boolean;
  agentOn: boolean;
  /** Conversaciones en `atencion`. */
  waiting: number;
  /** Conversaciones en `atendiendo` + turnos del agente en cola. */
  working: number;
  /** Los enlaces a Configuración y Agente son del propietario. */
  owner: boolean;
};

export type SystemVerdict = {
  state: SystemState;
  /** Una frase: por qué está así. */
  reason: string;
  /** Dónde se resuelve, si hay algo que hacer y quien mira puede hacerlo. */
  href: string | null;
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * El estado del negocio entero. Primero lo que impide funcionar (WhatsApp, el
 * plan), después quien espera, después si está apagado a propósito, y recién
 * entonces si está trabajando o todo en orden.
 */
export function systemState(i: SystemInput): SystemVerdict {
  const own = (href: string) => (i.owner ? href : null);
  if (i.whatsapp === "missing") {
    return { state: "atencion", reason: "Conecta tu WhatsApp para empezar a atender.", href: own("/settings/whatsapp") };
  }
  if (i.whatsapp === "reconnect_required") {
    return { state: "atencion", reason: "Meta cortó el acceso: reconecta tu WhatsApp.", href: own("/settings/whatsapp") };
  }
  if (!i.billingActive) {
    return { state: "atencion", reason: "Reactiva tu plan para que allok siga contestando.", href: own("/settings/billing") };
  }
  if (i.waiting > 0) {
    return {
      state: "atencion",
      reason: `${plural(i.waiting, "conversación espera", "conversaciones esperan")} por ti.`,
      href: "/inbox",
    };
  }
  if (!i.agentOn) {
    return { state: "pausado", reason: "El agente está apagado: contestas tú.", href: own("/agent") };
  }
  if (i.working > 0) {
    return {
      state: "atendiendo",
      reason: `Respondiendo ${plural(i.working, "conversación", "conversaciones")} ahora.`,
      href: "/inbox",
    };
  }
  return { state: "activo", reason: "Todo en orden. allok contesta por ti.", href: null };
}

export type SystemSnapshot = SystemVerdict & {
  whatsapp: { status: WhatsAppLink; phone: string | null };
  waiting: number;
  working: number;
};

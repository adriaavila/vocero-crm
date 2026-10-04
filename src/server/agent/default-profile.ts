import { activeBrandId, type BrandId } from "@/lib/brand";
import { SUGGESTED_HANDOFF } from "@/lib/negocio";
import { isValidTimeZone } from "@/lib/time/slots";
import type { WeeklyBusinessHours } from "@/server/business-hours";

/** Versión de la plantilla aplicada al crear una organización SaaS. */
export const DEFAULT_AGENT_TEMPLATE_VERSION = "saas-v1" as const;

/**
 * Todo negocio nuevo nace con el agente EN PAUSA, lo cree el alta pública o un
 * admin de allok: con un número conectado y sin saber nada del negocio, un
 * agente encendido le contestaría a sus clientes. Lo enciende el dueño en el
 * paso «Activar», con el número, el horario y las pruebas a la vista. Los
 * negocios que ya existen no se tocan: esto solo decide cómo nacen los nuevos.
 */
export const DEFAULT_AGENT_PROFILE = {
  enabled: false,
  name: "Rei",
  tone: "Profesional, cálido, cercano y consultivo.",
  instructions:
    "Somos un negocio que atiende consultas de clientes por WhatsApp. Informa con claridad y orienta a cada persona según su necesidad. Usa únicamente la ficha y la knowledge base de este negocio como fuente de verdad. Nunca inventes precios, horarios, disponibilidad, políticas, enlaces ni datos de contacto. Si falta información, indica que la confirmarás con el equipo. Cuando corresponda, solicita los datos necesarios para que el equipo dé seguimiento.",
  // En voz del dueño y marcada como sugerencia en «Tu negocio» (ver `SUGGESTED_HANDOFF`).
  escalationRules: SUGGESTED_HANDOFF,
  greeting: "¡Hola! Soy Rei, el asistente virtual de este negocio. ¿En qué puedo ayudarte?",
  activationEnabled: false,
  activationMessages: [] as string[],
  allowlistEnabled: false,
  allowedWaIds: [] as string[],
  aiProvider: "openrouter" as const,
};

/**
 * Nombre y saludo con los que nace el agente según la marca: Rei se presenta
 * como Rei; en allok el agente es «Asistente» (el dueño le pone el nombre que
 * quiera en Avanzado). El saludo de allok no repite el nombre: «Soy Asistente»
 * suena a error.
 */
const ALLOK_AGENT_IDENTITY = {
  name: "Asistente",
  greeting: "¡Hola! Te atiende el asistente virtual de este negocio. ¿En qué puedo ayudarte?",
};

export function defaultAgentProfile(brandId: BrandId = activeBrandId()) {
  return {
    ...DEFAULT_AGENT_PROFILE,
    ...(brandId === "rei" ? {} : ALLOK_AGENT_IDENTITY),
    activationMessages: [...DEFAULT_AGENT_PROFILE.activationMessages],
    allowedWaIds: [...DEFAULT_AGENT_PROFILE.allowedWaIds],
  };
}

/**
 * Horario de respuesta con el que nace un negocio SaaS. Sin horario,
 * `canAgentRespondNow` nunca deja contestar y el negocio recién creado queda
 * mudo.
 *
 * "Fuera de horario" con el negocio abierto de lunes a sábado de 9 a 18 es lo
 * único que vale en todos los planes ("Todo el día" es de Pro): el agente
 * contesta de noche y el domingo. El dueño lo cambia en Agente → Horario de
 * respuesta.
 *
 * La zona es la del navegador de quien se registra. Sin ella (o si no es
 * válida) queda la de la columna, Ciudad de México: en Caracas eso dejaría al
 * negocio sin respuesta de 18 a 20, justo cuando el equipo ya se fue.
 */
export function defaultResponseSchedule(timezone?: string | null) {
  const open = () => [{ start: "09:00", end: "18:00" }];
  const businessHours: WeeklyBusinessHours = {
    mon: open(),
    tue: open(),
    wed: open(),
    thu: open(),
    fri: open(),
    sat: open(),
  };
  return {
    businessHours,
    responseMode: "outside_hours" as const,
    ...(timezone && isValidTimeZone(timezone) ? { businessTimezone: timezone } : {}),
  };
}

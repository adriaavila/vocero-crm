import type { WeeklyBusinessHours } from "@/server/business-hours";

/** Versión de la plantilla aplicada al crear una organización SaaS. */
export const DEFAULT_AGENT_TEMPLATE_VERSION = "saas-v1" as const;

export const DEFAULT_AGENT_PROFILE = {
  enabled: true,
  name: "Rei",
  tone: "Profesional, cálido, cercano y consultivo.",
  instructions:
    "Somos un negocio que atiende consultas de clientes por WhatsApp. Informa con claridad y orienta a cada persona según su necesidad. Usa únicamente la ficha y la knowledge base de este negocio como fuente de verdad. Nunca inventes precios, horarios, disponibilidad, políticas, enlaces ni datos de contacto. Si falta información, indica que la confirmarás con el equipo. Cuando corresponda, solicita los datos necesarios para que el equipo dé seguimiento.",
  escalationRules:
    "Pasa la conversación a un humano si el cliente lo solicita, si pide una excepción o decisión que no esté documentada, si hay una queja sensible o si la información necesaria no está en la knowledge base.",
  greeting: "¡Hola! Soy Rei, el asistente virtual de este negocio. ¿En qué puedo ayudarte?",
  activationEnabled: false,
  activationMessages: [] as string[],
  allowlistEnabled: false,
  allowedWaIds: [] as string[],
  aiProvider: "openrouter" as const,
};

export function defaultAgentProfile() {
  return {
    ...DEFAULT_AGENT_PROFILE,
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
 * contesta de noche y el domingo, en la zona por defecto de la columna. El
 * dueño lo cambia en Agente → Horario de respuesta.
 */
export function defaultResponseSchedule() {
  const open = () => [{ start: "09:00", end: "18:00" }];
  const businessHours: WeeklyBusinessHours = {
    mon: open(),
    tue: open(),
    wed: open(),
    thu: open(),
    fri: open(),
    sat: open(),
  };
  return { businessHours, responseMode: "outside_hours" as const };
}

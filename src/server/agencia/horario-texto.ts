import { describeTeamHours, timezoneLabel } from "@/lib/horario";
import { addDaysISO, dayIsoInTz, zonedWallClockToUtc } from "@/lib/time/slots";
import {
  hasConfiguredBusinessHours,
  isBusinessHoursOpen,
  isOutsideBusinessHours,
  type BusinessHoursSettings,
} from "@/server/business-hours";

export { describeTeamHours, timezoneLabel };

/**
 * Capa de agencia: el horario de respuesta en palabras de dueño, para la
 * pantalla «Activar». Es la misma regla que aplica el servidor
 * (`canAgentRespondNow`), dicha en una frase: «¿cuándo contesta mi agente?»
 * y «¿contesta ahora?». Puro: recibe el horario y el instante.
 */

/**
 * El próximo instante (desde `now`) en que el agente puede responder, o null
 * si no hay ninguno en la semana que viene. Revisa solo los bordes de los
 * tramos del equipo (inicio y fin de cada uno, más el comienzo de cada día):
 * entre dos bordes la regla no cambia.
 */
export function nextAgentStart(settings: BusinessHoursSettings, now: Date): Date | null {
  if (!hasConfiguredBusinessHours(settings)) return null;
  if (settings.responseMode === "all_day" || isOutsideBusinessHours(settings, now)) return now;

  // Los bordes de toda la semana en cada día: un tramo que cruza la medianoche
  // (22:00 a 06:00) termina al día siguiente, y ese borde no está en la lista
  // de ese día.
  const edges = new Set<string>(["00:00"]);
  for (const intervals of Object.values(settings.weeklyHours)) {
    for (const interval of intervals ?? []) {
      edges.add(interval.start);
      edges.add(interval.end);
    }
  }
  const today = dayIsoInTz(now, settings.timezone);
  const candidates: Date[] = [];
  for (let offset = 0; offset <= 7; offset += 1) {
    const day = addDaysISO(today, offset);
    for (const time of edges) {
      const instant = zonedWallClockToUtc(day, time, settings.timezone);
      if (instant && instant.getTime() > now.getTime()) candidates.push(instant);
    }
  }
  candidates.sort((a, b) => a.getTime() - b.getTime());
  return candidates.find((instant) => isOutsideBusinessHours(settings, instant)) ?? null;
}

function whenText(instant: Date, now: Date, timezone: string): string {
  const day = dayIsoInTz(instant, timezone);
  const today = dayIsoInTz(now, timezone);
  const time = new Intl.DateTimeFormat("es-MX", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(instant);
  if (day === today) return `hoy a las ${time}`;
  if (day === addDaysISO(today, 1)) return `mañana a las ${time}`;
  const weekday = new Intl.DateTimeFormat("es-MX", { timeZone: timezone, weekday: "long" }).format(instant);
  return `el ${weekday} a las ${time}`;
}

export type ScheduleDescription = {
  /** La regla: cuándo atiende cada quien. */
  rule: string;
  /** Qué pasa ahora mismo. */
  now: string;
  /** La zona, para que nadie dude de «las 18:00». */
  timezone: string;
};

export function describeAgentSchedule(
  settings: BusinessHoursSettings,
  now: Date = new Date(),
): ScheduleDescription | null {
  if (!hasConfiguredBusinessHours(settings)) return null;
  const timezone = `Hora de ${timezoneLabel(settings.timezone)}`;

  if (settings.responseMode === "all_day") {
    return {
      rule: "Tu agente responde todos los días, a toda hora.",
      now: "Ahora mismo responde tu agente.",
      timezone,
    };
  }

  const team = describeTeamHours(settings);
  const rule = team
    ? `Atiendes tú ${team}. Tu agente responde el resto del tiempo.`
    : "Tu agente responde todos los días, a toda hora.";
  if (isBusinessHoursOpen(settings, now)) {
    const start = nextAgentStart(settings, now);
    return {
      rule,
      now: start
        ? `Ahora atiendes tú. Tu agente empieza a responder ${whenText(start, now, settings.timezone)}.`
        : "Ahora atiendes tú.",
      timezone,
    };
  }
  return { rule, now: "Ahora mismo responde tu agente.", timezone };
}

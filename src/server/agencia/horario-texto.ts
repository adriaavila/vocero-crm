import {
  addDaysISO,
  dayIsoInTz,
  WEEKDAYS,
  zonedWallClockToUtc,
  type WeekdayKey,
} from "@/lib/time/slots";
import {
  hasConfiguredBusinessHours,
  isBusinessHoursOpen,
  isOutsideBusinessHours,
  type BusinessHoursSettings,
  type BusinessInterval,
} from "@/server/business-hours";

/**
 * Capa de agencia: el horario de respuesta en palabras de dueño, para la
 * pantalla «Activar». Es la misma regla que aplica el servidor
 * (`canAgentRespondNow`), dicha en una frase: «¿cuándo contesta mi agente?»
 * y «¿contesta ahora?». Puro: recibe el horario y el instante.
 */

const DAY_NAME: Record<WeekdayKey, string> = {
  mon: "lunes",
  tue: "martes",
  wed: "miércoles",
  thu: "jueves",
  fri: "viernes",
  sat: "sábado",
  sun: "domingo",
};

function isAllDay(interval: BusinessInterval): boolean {
  return interval.start === "00:00" && interval.end === "00:00";
}

function intervalsText(intervals: BusinessInterval[]): string {
  if (intervals.some(isAllDay)) return "todo el día";
  return intervals.map((interval) => `de ${interval.start} a ${interval.end}`).join(" y ");
}

function daysText(days: WeekdayKey[]): string {
  const names = days.map((day) => DAY_NAME[day]);
  if (names.length === 1) return names[0]!;
  if (names.length === 2) return `${names[0]} y ${names[1]}`;
  return `${names[0]} a ${names[names.length - 1]}`;
}

/**
 * Cuándo atiende el equipo: «lunes a sábado, de 09:00 a 18:00». Los días
 * seguidos con las mismas horas se juntan; null si no hay ningún día con horas.
 */
export function describeTeamHours(settings: BusinessHoursSettings): string | null {
  const groups: { days: WeekdayKey[]; signature: string; text: string }[] = [];
  for (const day of WEEKDAYS) {
    const intervals = settings.weeklyHours[day];
    if (!intervals?.length) continue;
    const signature = JSON.stringify(intervals);
    const last = groups[groups.length - 1];
    const previousDay = last?.days[last.days.length - 1];
    const consecutive = previousDay !== undefined && WEEKDAYS.indexOf(previousDay) === WEEKDAYS.indexOf(day) - 1;
    if (last && last.signature === signature && consecutive) {
      last.days.push(day);
    } else {
      groups.push({ days: [day], signature, text: intervalsText(intervals) });
    }
  }
  if (groups.length === 0) return null;
  return groups.map((group) => `${daysText(group.days)}, ${group.text}`).join("; ");
}

/** «America/Caracas» → «Caracas». */
export function timezoneLabel(timezone: string): string {
  const city = timezone.split("/").pop() ?? timezone;
  return city.replace(/_/g, " ");
}

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

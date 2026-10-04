import { WEEKDAYS, type WeekdayKey } from "@/lib/time/slots";

/**
 * El horario de respuesta dicho en palabras de dueño. Puro y sin servidor
 * (solo tipos estructurales), para usarlo igual en la pantalla de Tu agente y
 * en «Activar» (`server/agencia/horario-texto.ts` lo reexporta).
 */

type Interval = { start: string; end: string };
type WeeklyHours = Partial<Record<WeekdayKey, Interval[]>>;

const DAY_NAME: Record<WeekdayKey, string> = {
  mon: "lunes",
  tue: "martes",
  wed: "miércoles",
  thu: "jueves",
  fri: "viernes",
  sat: "sábado",
  sun: "domingo",
};

function isAllDay(interval: Interval): boolean {
  return interval.start === "00:00" && interval.end === "00:00";
}

function intervalsText(intervals: Interval[]): string {
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
export function describeTeamHours(settings: { weeklyHours: WeeklyHours }): string | null {
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

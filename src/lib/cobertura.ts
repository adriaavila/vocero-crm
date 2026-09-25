import { WEEKDAYS, type WeekdayKey } from "@/lib/time/slots";

/**
 * Capa de agencia (fork) — quién contesta en cada minuto del día del negocio.
 * Puro: lo dibujan la línea del día de Inicio (servidor) y la semana del
 * agente (cliente, mientras el dueño edita). Mismas reglas que
 * `server/business-hours.ts`: un intervalo que cruza la medianoche sigue en
 * el día siguiente, 00:00–00:00 es el día entero, en «Fuera de horario» el
 * agente contesta cuando el equipo no, y «Todo el día» es de Pro.
 */

/** [desde, hasta) en minutos del día, 0–1440. */
export type Span = [number, number];
export type Week = Partial<Record<WeekdayKey, { start: string; end: string }[]>>;
export type ResponseMode = "outside_hours" | "all_day";

const DAY = 1440;
const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

export function previousDay(day: WeekdayKey): WeekdayKey {
  return WEEKDAYS[(WEEKDAYS.indexOf(day) + 6) % 7] ?? day;
}

export function nextDay(day: WeekdayKey): WeekdayKey {
  return WEEKDAYS[(WEEKDAYS.indexOf(day) + 1) % 7] ?? day;
}

function merge(spans: Span[]): Span[] {
  const out: Span[] = [];
  for (const [a, b] of spans.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0])) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

/** Cuándo atiende el equipo ese día, con lo que le queda de la noche anterior. */
export function teamSpans(week: Week, day: WeekdayKey): Span[] {
  const spans: Span[] = [];
  for (const { start, end } of week[day] ?? []) {
    if (start === "00:00" && end === "00:00") spans.push([0, DAY]);
    else if (start !== end) spans.push([toMin(start), toMin(start) < toMin(end) ? toMin(end) : DAY]);
  }
  for (const { start, end } of week[previousDay(day)] ?? []) {
    if (toMin(start) > toMin(end)) spans.push([0, toMin(end)]);
  }
  return merge(spans);
}

/** Lo que el equipo deja libre ese día. */
export function gaps(spans: Span[]): Span[] {
  const out: Span[] = [];
  let at = 0;
  for (const [a, b] of spans) {
    if (a > at) out.push([at, a]);
    at = Math.max(at, b);
  }
  if (at < DAY) out.push([at, DAY]);
  return out;
}

/** Quién contesta ese día. Sin horario guardado, o «Todo el día» sin Pro, el agente calla. */
export function coverage(week: Week, mode: ResponseMode, pro: boolean, day: WeekdayKey): { team: Span[]; agent: Span[] } {
  const team = teamSpans(week, day);
  if (mode === "all_day") return { team, agent: pro ? [[0, DAY]] : [] };
  const configured = WEEKDAYS.some((d) => (week[d]?.length ?? 0) > 0);
  return { team, agent: configured ? gaps(team) : [] };
}

export const inside = (spans: Span[], minute: number) => spans.some(([a, b]) => minute >= a && minute < b);

/** Minuto del día (0–1439) de un instante, en la zona del negocio. */
export function minuteInTz(date: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return (get("hour") % 24) * 60 + get("minute");
}

/** Día de la semana de un instante, en la zona del negocio. */
export function weekdayInTz(date: Date, tz: string): WeekdayKey {
  const short = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(date).toLowerCase();
  return WEEKDAYS.find((d) => short.startsWith(d)) ?? "mon";
}

/** 09:00, 18:30 — la hora de un minuto del día. */
export function hhmm(minute: number): string {
  return `${String(Math.floor(minute / 60) % 24).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

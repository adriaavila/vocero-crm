/**
 * «hace 5 min», «hoy a las 14:30», «ayer a las 09:00»: cuándo pasó algo, en
 * palabras. Puro y sin servidor; en el navegador usa la hora del dueño (sin
 * `timeZone`), y las pruebas fijan una.
 */

const MIN = 60_000;

function dayKey(date: Date, timeZone?: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

export function haceTexto(value: string | Date, now: Date = new Date(), timeZone?: string): string {
  const date = new Date(value);
  const diff = now.getTime() - date.getTime();
  if (diff < MIN) return "hace un momento";
  if (diff < 60 * MIN) return `hace ${Math.floor(diff / MIN)} min`;
  const time = new Intl.DateTimeFormat("es-MX", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
  if (dayKey(date, timeZone) === dayKey(now, timeZone)) return `hoy a las ${time}`;
  if (dayKey(date, timeZone) === dayKey(new Date(now.getTime() - 24 * 60 * MIN), timeZone)) return `ayer a las ${time}`;
  const day = new Intl.DateTimeFormat("es-MX", { timeZone, day: "numeric", month: "short" }).format(date).replace(/\./g, "");
  return `el ${day} a las ${time}`;
}

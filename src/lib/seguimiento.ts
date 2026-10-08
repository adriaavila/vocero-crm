/**
 * Fork — seguimiento al cliente que dejó de contestar (puro, probado).
 *
 * El agente contesta, el cliente lee y se olvida. Una persona del negocio le
 * escribiría unas horas después («¿pudiste verlo?»); el agente, sin esto, se
 * quedaba callado para siempre. Aquí viven las reglas que no tocan la base:
 * qué opciones ofrece Ajustes, a qué horas del día se permite escribir y el
 * texto de la conversación que se le da al modelo.
 */

/** Opciones del selector. 0 = apagado. */
export const SEGUIMIENTO_CHOICES = [0, 2, 4, 8, 20] as const;
export const SEGUIMIENTO_RECOMENDADO = 4;
/** WhatsApp deja escribir texto libre hasta 24 h después del último mensaje del cliente. */
export const VENTANA_HORAS = 24;
/** Margen antes de que cierre la ventana: no se arriesga un envío que Meta rechace. */
export const MARGEN_VENTANA_MS = 30 * 60_000;
/** Nunca de noche en la zona del negocio: de 8:00 a 21:00. */
export const HORA_DESDE = 8;
export const HORA_HASTA = 21;

export function normalizarSeguimiento(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(n) || n < 0 || n >= VENTANA_HORAS) return null;
  return n === 0 ? null : n;
}

export function seguimientoLabel(hours: number): string {
  if (hours === 0) return "No le escribas";
  return `Le escribe ${hours} horas después${hours === SEGUIMIENTO_RECOMENDADO ? " (recomendado)" : ""}`;
}

/** Hora local (0–23) del instante en la zona del negocio. */
export function horaLocal(now: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "2-digit", hourCycle: "h23" }).formatToParts(now);
  return Number(parts.find((p) => p.type === "hour")?.value ?? "0") % 24;
}

export function horaDecente(now: Date, timezone: string): boolean {
  const h = horaLocal(now, timezone);
  return h >= HORA_DESDE && h < HORA_HASTA;
}

/**
 * ¿Toca escribirle ya? El cliente calló `hours` horas desde la última
 * respuesta del agente y la ventana de 24 h sigue abierta con margen.
 */
export function tocaSeguimiento(input: {
  hours: number;
  lastInboundAt: Date;
  lastMessageAt: Date;
  now: Date;
}): boolean {
  const { hours, lastInboundAt, lastMessageAt, now } = input;
  if (hours <= 0) return false;
  if (now.getTime() - lastMessageAt.getTime() < hours * 3_600_000) return false;
  const cierra = lastInboundAt.getTime() + VENTANA_HORAS * 3_600_000 - MARGEN_VENTANA_MS;
  return now.getTime() < cierra;
}

export type LineaHilo = { direction: "in" | "out"; text: string | null };

/** «Cliente: …» / «Tú: …», solo lo que tiene texto, los últimos `max`. */
export function transcriptoSeguimiento(hilo: LineaHilo[], max = 14): string {
  return hilo
    .filter((m) => m.text?.trim())
    .slice(-max)
    .map((m) => `${m.direction === "in" ? "Cliente" : "Tú"}: ${m.text!.trim().replace(/\s+/g, " ").slice(0, 600)}`)
    .join("\n");
}

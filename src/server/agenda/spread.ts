import { dayIsoInTz, dayLabelInTz, timeInTz } from "@/lib/time/slots";
import type { AvailableSlot } from "@/server/agenda/availability";

/**
 * 015 — Reparto de huecos entre días distintos.
 *
 * Los N huecos más próximos casi siempre caen todos HOY, y entonces quien
 * conduce la conversación no tiene nada que ofrecer cuando el lead dice "¿y
 * el jueves?". Esto toma `perDay` por día hasta completar `limit`, de modo que
 * la oferta cubra varios días.
 *
 * El catálogo reservable es MÁS ANCHO que el menú que se muestra: se ofrecen
 * (y se registran) hasta `limit`, aunque el agente enseñe tres. Guardar solo lo
 * enseñado dejaba al agente sin alternativas legítimas que aceptar.
 */

export type SpreadSlot = AvailableSlot & {
  /** Día del slot en la zona del negocio (YYYY-MM-DD). */
  dayIso: string;
  /** El día EN PALABRAS: "hoy miércoles 5 de agosto". */
  dayLabel: string;
  /** Solo la hora: "10:00". */
  time: string;
};

export function spreadByDay(
  slots: AvailableSlot[],
  opts: { timezone: string; limit: number; perDay: number; now?: Date }
): SpreadSlot[] {
  const { timezone, limit, perDay } = opts;
  const now = opts.now ?? new Date();
  if (limit <= 0 || perDay <= 0) return [];

  const byDay = new Map<string, AvailableSlot[]>();
  for (const slot of slots) {
    const dayIso = dayIsoInTz(new Date(slot.startUtc), timezone);
    const bucket = byDay.get(dayIso);
    if (bucket) bucket.push(slot);
    else byDay.set(dayIso, [slot]);
  }

  // Los días ya vienen ordenados porque `slots` viene ordenado; el Map
  // conserva el orden de inserción.
  const out: SpreadSlot[] = [];
  for (const [dayIso, daySlots] of byDay) {
    for (const slot of daySlots.slice(0, perDay)) {
      if (out.length >= limit) return out;
      out.push({
        ...slot,
        dayIso,
        dayLabel: dayLabelInTz(slot.startUtc, timezone, now),
        time: timeInTz(slot.startUtc, timezone),
      });
    }
  }
  return out;
}

/** Los días (YYYY-MM-DD) que tienen algo que ofrecer. Los ausentes NO. */
export function daysWithAgenda(slots: SpreadSlot[]): string[] {
  return [...new Set(slots.map((s) => s.dayIso))];
}

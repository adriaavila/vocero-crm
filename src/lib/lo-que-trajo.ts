/**
 * Capa de agencia — «Lo que te trajo tu agente»: los números y sus frases.
 * Puro (sin base) para usarlo en Inicio, en el resumen de las 19:00 y en las
 * pruebas. Los calcula `server/agencia/lo-que-trajo.ts`.
 */

export type LoQueTrajo = {
  /** La moneda del negocio (Ajustes → Marca): la única que se suma. */
  currency: string;
  /** ¿Esta instancia agenda citas? Sin agenda, las citas ni se mencionan. */
  agenda: boolean;
  /** Citas que agendó el agente en el periodo. */
  citas: number;
  /** Cuánto le deja una cita al negocio, si el dueño lo dijo. */
  valorCitaCents: number | null;
  /** Ventas cerradas en el periodo, y su monto en la moneda del negocio. */
  ventas: { count: number; cents: number };
};

/** Lo que valen las citas del agente, o `null` si el dueño no dijo cuánto vale una. */
export function valorCitasCents(l: Pick<LoQueTrajo, "citas" | "valorCitaCents">): number | null {
  return l.valorCitaCents ? l.citas * l.valorCitaCents : null;
}

/** Citas valuadas más ventas cerradas: la plata que se puede mostrar sin inventar nada. */
export function totalCents(l: LoQueTrajo): number {
  return (valorCitasCents(l) ?? 0) + l.ventas.cents;
}

/** ¿Hay algo que contar en este bloque? Sin agenda y sin ventas, no se dibuja. */
export function hayQueContar(l: LoQueTrajo): boolean {
  return l.agenda || l.ventas.count > 0;
}

/** Plata redonda para una frase: «$1,800», sin centavos. */
export function plata(cents: number, currency: string, locale = "es-MX"): string {
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency, currencyDisplay: "narrowSymbol", maximumFractionDigits: 0, minimumFractionDigits: 0 }).format(Math.round(cents / 100));
  } catch {
    return `${Math.round(cents / 100)} ${currency}`;
  }
}

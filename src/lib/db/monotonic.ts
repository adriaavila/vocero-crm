import { sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";

/**
 * `GREATEST(columna, instante)`: un reloj de la conversación o del lead solo
 * avanza. Un evento viejo (replay del webhook, reintento tardío de Meta) llega
 * después de uno más nuevo y no puede moverlo hacia atrás. `GREATEST` ignora el
 * NULL, así que una columna vacía toma el instante.
 *
 * El instante va como texto con cast explícito: postgres-js no serializa un
 * `Date` crudo dentro de un `sql` (tipo desconocido).
 */
export function notBefore(column: PgColumn, at: Date): SQL {
  const iso = at.toISOString();
  return sql`greatest(${column}, ${iso}::timestamp)`;
}

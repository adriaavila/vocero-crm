import { eq, gte, lt, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import type { LoQueTrajo } from "@/lib/lo-que-trajo";
import { agendaEnabled } from "@/server/agenda/flag";
import { clasificarCierres, desenlacesDelPeriodo } from "@/server/analytics/sales";

/**
 * Capa de agencia — lo que el agente le trajo al negocio, en plata.
 *
 * Un dueño no paga por «37 mensajes contestados»: paga por clientes que
 * agendaron o compraron. Aquí se cuentan las citas que agendó el agente en el
 * periodo (sin las del Laboratorio ni los bloqueos) y, si el dueño dijo cuánto
 * le deja una cita, cuánto valen. Las ventas cerradas salen de lo mismo que
 * Resultados (`analytics/sales`). Nada se estima sin un dato del dueño: sin
 * valor por cita, las citas se cuentan y no se les pone precio.
 */

export async function citasDelAgente(organizationId: string, start: Date, end: Date): Promise<number> {
  const b = schema.booking;
  const rows = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(b)
    .where(
      scoped(
        b.organizationId,
        organizationId,
        eq(b.source, "ai"),
        eq(b.kind, "session"),
        eq(b.isTest, false),
        gte(b.createdAt, start),
        lt(b.createdAt, end),
      ),
    );
  return rows[0]?.n ?? 0;
}

export async function valorCita(organizationId: string): Promise<number | null> {
  const rows = await getDb()
    .select({ cents: schema.agentProfile.valorCitaCents })
    .from(schema.agentProfile)
    .where(scoped(schema.agentProfile.organizationId, organizationId))
    .limit(1);
  const cents = rows[0]?.cents ?? null;
  return cents && cents > 0 ? cents : null;
}

export async function getLoQueTrajo(
  organizationId: string,
  { start, end }: { start: Date; end: Date },
  currency: string,
): Promise<LoQueTrajo> {
  const [citas, valorCitaCents, desenlaces] = await Promise.all([
    citasDelAgente(organizationId, start, end),
    valorCita(organizationId),
    desenlacesDelPeriodo(organizationId, start, end),
  ]);
  const cierres = clasificarCierres(desenlaces, currency);
  return {
    currency,
    agenda: agendaEnabled(),
    citas,
    valorCitaCents,
    ventas: { count: cierres.won.length, cents: cierres.wonCents },
  };
}

/** Guarda cuánto le deja una cita al negocio; `null` lo borra. */
export async function guardarValorCita(organizationId: string, cents: number | null): Promise<void> {
  await getDb()
    .update(schema.agentProfile)
    .set({ valorCitaCents: cents })
    .where(scoped(schema.agentProfile.organizationId, organizationId));
}

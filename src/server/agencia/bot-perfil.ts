import { and, asc, eq, gte } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { partsInTz } from "@/lib/time/slots";
import { getSettings } from "@/server/agenda/settings";
import { agendaEnabled } from "@/server/agenda/flag";

/**
 * Capa de agencia — lo que el cerebro externo necesita y el contrato de
 * upstream no lleva.
 *
 * Upstream sirve `/api/bot/profile` y `/api/bot/context` pensando en una
 * instancia que su propio dueño configuró: el bot habla con todo el mundo,
 * siempre. En el modelo de agencia una instancia se ENTREGA, y durante el
 * piloto hacen falta dos frenos que el CRM administra y el bot obedece:
 *
 *  · **allowlist** — mientras se prueba, el agente solo le contesta a los
 *    números del equipo. Sin esto, el primer lead real de un cliente es el
 *    conejillo de indias.
 *  · **mensajes de activación** (preset) — el agente solo arranca cuando el
 *    mensaje entrante coincide con una frase acordada (el anuncio, el QR).
 *    Los demás quedan para un humano.
 *
 * Viven aquí y no dentro de `server/bot/` para que las fusiones con upstream
 * no tengan que resolver nada: el fork añade campos, nunca reescribe los de
 * upstream.
 *
 * REGLA DE CONTRATO: estos campos viajan SIEMPRE, aunque estén apagados. Un
 * bot que lee `activationEnabled` de un payload donde la clave no existe
 * concluye "falso" y se suelta a contestar libremente — el freno desaparece
 * sin que nada falle a la vista. Esa es la forma más cara de romper esto.
 */

/** Campos extra de `/api/bot/profile`. */
export async function perfilDeAgencia(organizationId: string): Promise<{
  activationEnabled: boolean;
  activationMessages: string[];
  timezone: string;
}> {
  const rows = await getDb()
    .select({
      activationEnabled: schema.agentProfile.activationEnabled,
      activationMessages: schema.agentProfile.activationMessages,
    })
    .from(schema.agentProfile)
    .where(scoped(schema.agentProfile.organizationId, organizationId))
    .limit(1);

  const row = rows[0];
  // La zona del NEGOCIO, no la del servidor ni la del bot.
  //
  // El cerebro externo redacta "mañana" y "el jueves" con su propio reloj. Si
  // ese reloj no es el mismo con el que el motor etiquetó los huecos, el
  // agente y el CRM hablan de dos jueves distintos: el modelo ofrece un día y
  // reserva otro, o propone una hora que ya pasó. Una constante en el bot
  // (`America/Mexico_City` cableada) es el mismo fallo con más pasos.
  //
  // La verdad vive en `calendar_settings`, que es de donde salen las
  // etiquetas. Viaja siempre, con la agenda encendida o apagada: la fecha de
  // referencia le hace falta al agente aunque no agende nada.
  const settings = await getSettings(organizationId);
  return {
    activationEnabled: row?.activationEnabled ?? false,
    // Tolerante a propósito: la columna guardó objetos `{message}` en una
    // versión vieja del fork, y una instancia sin migrar no debe tumbar el
    // perfil entero por un formato heredado.
    activationMessages: normalizarMensajes(row?.activationMessages),
    timezone: settings.timezone,
  };
}

function normalizarMensajes(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) =>
      typeof item === "string"
        ? item
        : String((item as { message?: unknown })?.message ?? "")
    )
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Campos extra de `/api/bot/context`. */
export async function accesoDeAgencia(organizationId: string): Promise<{
  allowlistEnabled: boolean;
  allowedWaIds: string[];
}> {
  const rows = await getDb()
    .select({
      allowlistEnabled: schema.agentProfile.allowlistEnabled,
      allowedWaIds: schema.agentProfile.allowedWaIds,
    })
    .from(schema.agentProfile)
    .where(scoped(schema.agentProfile.organizationId, organizationId))
    .limit(1);

  const row = rows[0];
  return {
    allowlistEnabled: row?.allowlistEnabled ?? false,
    allowedWaIds: Array.isArray(row?.allowedWaIds)
      ? (row.allowedWaIds as unknown[]).map(String).filter(Boolean)
      : [],
  };
}

export type ProximaCita = {
  id: string;
  scheduledAtUtc: string;
  /** Cómo se dice esa hora en la zona del negocio, ya redactado. */
  label: string;
  meetingLink: string | null;
};

/**
 * La próxima cita del contacto, para que el agente no vuelva a ofrecer
 * horarios a quien ya tiene una. El agente que agenda dos veces al mismo lead
 * es el que peor se ve: el cliente cree que el negocio no se entera de nada.
 *
 * Devuelve `null` con la agenda apagada — no es un error, es que aquí no hay
 * agenda.
 */
export async function proximaCita(
  organizationId: string,
  contactId: string,
  now = new Date()
): Promise<ProximaCita | null> {
  if (!agendaEnabled()) return null;

  const rows = await getDb()
    .select({
      id: schema.booking.id,
      scheduledAt: schema.booking.scheduledAt,
      meetingLink: schema.booking.meetingLink,
    })
    .from(schema.booking)
    .where(
      scoped(
        schema.booking.organizationId,
        organizationId,
        and(
          eq(schema.booking.contactId, contactId),
          eq(schema.booking.status, "agendada"),
          eq(schema.booking.isTest, false),
          gte(schema.booking.scheduledAt, now)
        )
      )
    )
    .orderBy(asc(schema.booking.scheduledAt))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  const settings = await getSettings(organizationId);
  const scheduledAtUtc = row.scheduledAt.toISOString();
  const parts = partsInTz(scheduledAtUtc, settings.timezone);
  return {
    id: row.id,
    scheduledAtUtc,
    label: `${parts.weekday} ${parts.date} a las ${parts.time}`,
    meetingLink: row.meetingLink,
  };
}

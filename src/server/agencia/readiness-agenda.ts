import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { agendaEnabled } from "@/server/agenda/flag";
import { bindConnector } from "@/server/agenda/connectors";
import { getSettings } from "@/server/agenda/settings";

/**
 * Capa de agencia — el paso de la agenda en la puesta en marcha.
 *
 * La lista de `server/readiness.ts` comprueba que el agente sepa hablar. En
 * una instancia que además AGENDA, falta la mitad que decide si el cliente
 * consigue su cita: sin horario semanal el motor no tiene un solo hueco que
 * ofrecer, y el agente contesta "por ahora no me quedan horarios libres" a
 * todos los leads. Es correcto y es un desastre — se ve bien por fuera y no
 * agenda a nadie.
 *
 * Lo mismo con el conector: si el negocio eligió Zoom o Google y no dejó las
 * credenciales, las citas se crean con el enlace pendiente y alguien tiene que
 * mandarlo a mano, cita por cita.
 */

export type PasoAgenda = {
  id: "agenda";
  status: "complete" | "pending" | "unavailable";
  label: string;
  detail: string;
  href: string;
};

export async function pasoAgenda(
  organizationId: string
): Promise<PasoAgenda | null> {
  // Instancia sin agenda: el paso no existe, no aparece como pendiente.
  if (!agendaEnabled()) return null;

  const db = getDb();
  const filas = await db
    .select({ id: schema.calendarSettings.id })
    .from(schema.calendarSettings)
    .where(scoped(schema.calendarSettings.organizationId, organizationId))
    .limit(1);

  const base = {
    id: "agenda" as const,
    label: "Configura la agenda",
    href: "/settings/calendar",
  };

  if (!filas[0]) {
    return {
      ...base,
      status: "pending",
      detail:
        "Nadie ha guardado el horario del negocio: el agente no tiene huecos que ofrecer.",
    };
  }

  const settings = await getSettings(organizationId);
  const diasAbiertos = Object.values(settings.weeklyHours).filter(
    (intervalos) => (intervalos?.length ?? 0) > 0
  ).length;
  if (diasAbiertos === 0) {
    return {
      ...base,
      status: "pending",
      detail: "El horario semanal está vacío: la agenda no ofrece nada.",
    };
  }

  // El conector se comprueba resolviéndolo, que es lo que hará el motor al
  // agendar de verdad. Preguntar por la fila de credenciales por separado
  // sería una segunda verdad que puede desincronizarse de la primera.
  try {
    await bindConnector(organizationId, settings.connector, settings);
  } catch {
    return {
      ...base,
      status: "pending",
      detail: `Faltan las credenciales de ${settings.connector}: las citas se crearán sin enlace.`,
    };
  }

  return {
    ...base,
    status: "complete",
    detail: `${diasAbiertos} día(s) abiertos, citas de ${settings.slotMinutes} min (${settings.timezone}).`,
  };
}

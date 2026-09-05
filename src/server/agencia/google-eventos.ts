import { getEnv } from "@/lib/env";
import { getAccessToken } from "@/server/agenda/connectors/google";
import type { GoogleCreds } from "@/server/agenda/connectors/google-credentials";

/**
 * Capa de agencia — leer el calendario del dueño, solo para saber cuándo NO
 * ofrecer. Ver `server/agencia/agenda-externa.ts` para el porqué.
 *
 * Se usa `events.list` y no `freeBusy` a propósito: freeBusy devuelve
 * intervalos anónimos, y sin un id estable cada sincronización tendría que
 * borrar y recrear TODOS los bloqueos — que es como se pierde el bloqueo que
 * puso el dueño a mano por un error de emparejamiento. Con el id del evento el
 * espejo es idempotente, y de paso se pueden saltar los eventos que son citas
 * del propio Vocero.
 *
 * Alcance: el mismo `calendar.events` que ya pide el conector. No hace falta
 * pedirle al dueño un permiso nuevo.
 */

export type EventoExterno = {
  id: string;
  startUtc: string;
  endUtc: string;
  titulo: string | null;
};

/** Google se cae, y el lead está esperando. Corta pronto. */
const TIMEOUT_MS = 4_000;
const MAX_EVENTOS = 250;

type GoogleEventList = {
  items?: {
    id?: string;
    status?: string;
    summary?: string;
    transparency?: string;
    start?: { dateTime?: string; date?: string };
    end?: { dateTime?: string; date?: string };
  }[];
};

export async function googleBusyEvents(
  creds: GoogleCreds,
  ventana: { fromUtc: Date; toUtc: Date }
): Promise<EventoExterno[]> {
  const token = await getAccessToken(creds);
  const url = new URL(
    `${getEnv().GOOGLE_CAL_BASE_URL}/calendars/${encodeURIComponent(
      creds.calendarId
    )}/events`
  );
  url.searchParams.set("timeMin", ventana.fromUtc.toISOString());
  url.searchParams.set("timeMax", ventana.toUtc.toISOString());
  // Sin esto, un evento semanal llega UNA vez con su regla de repetición y
  // habría que expandirla a mano: la agenda quedaría libre todos los martes
  // menos el primero.
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("maxResults", String(MAX_EVENTOS));

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`Google respondió ${res.status} al listar eventos`);
  }
  const data = (await res.json().catch(() => null)) as GoogleEventList | null;
  return normalizarEventos(data, ventana);
}

/**
 * PURA: de la respuesta de Google a los intervalos que de verdad ocupan.
 *
 * Se descartan los que no ocupan al dueño aunque estén en su calendario:
 * cancelados, y los marcados "disponible" (`transparency: transparent`), que
 * es lo que la gente usa para recordatorios y cumpleaños. Bloquear por esos
 * vaciaría la agenda sin motivo.
 */
export function normalizarEventos(
  data: GoogleEventList | null,
  ventana: { fromUtc: Date; toUtc: Date }
): EventoExterno[] {
  const out: EventoExterno[] = [];
  for (const item of data?.items ?? []) {
    if (!item.id) continue;
    if (item.status === "cancelled") continue;
    if (item.transparency === "transparent") continue;

    // Evento de día completo: `date` en vez de `dateTime`. Ocupa el día, y se
    // recorta a la ventana para no crear un bloqueo de meses.
    const inicio = item.start?.dateTime ?? diaAInstante(item.start?.date, 0);
    const fin = item.end?.dateTime ?? diaAInstante(item.end?.date, 0);
    if (!inicio || !fin) continue;

    const desde = Math.max(Date.parse(inicio), ventana.fromUtc.getTime());
    const hasta = Math.min(Date.parse(fin), ventana.toUtc.getTime());
    if (!Number.isFinite(desde) || !Number.isFinite(hasta)) continue;
    if (hasta <= desde) continue;

    out.push({
      id: item.id,
      startUtc: new Date(desde).toISOString(),
      endUtc: new Date(hasta).toISOString(),
      titulo: item.summary ?? null,
    });
  }
  return out;
}

function diaAInstante(date: string | undefined, offsetDias: number): string | null {
  if (!date) return null;
  const ms = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(ms)) return null;
  return new Date(ms + offsetDias * 86_400_000).toISOString();
}

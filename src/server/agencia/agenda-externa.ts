import { and, eq, gte, isNotNull, lte } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { addDaysISO, todayInTz } from "@/lib/time/slots";
import { getGoogleCredentials } from "@/server/agenda/connectors/google-credentials";
import { getSettings } from "@/server/agenda/settings";
import { googleBusyEvents, type EventoExterno } from "@/server/agencia/google-eventos";

/**
 * Capa de agencia — la agenda de VERDAD del dueño, dentro del motor.
 *
 * El motor de upstream calcula disponibilidad 100% local y lo dice explícito:
 * "los compromisos de fuera se reflejan con bloqueos manuales". Su razón es
 * buena — meter a Google en el camino de la pantalla más usada le acopla la
 * latencia y las caídas del proveedor.
 *
 * Pero en el modelo de agencia el dueño VIVE en su Google Calendar y no va a
 * abrir Vocero a copiar bloqueos. El agente ofrece un martes a las 10 que el
 * dueño ya tiene ocupado, el lead lo acepta, y alguien queda mal. Ese es el
 * fallo que más rápido destruye la confianza en un agente que agenda.
 *
 * La salida es usar la puerta que upstream dejó abierta, automatizada: los
 * eventos del calendario se ESPEJAN como bloqueos (`kind: "block"`) en la
 * tabla del CRM. Así:
 *
 *  · `computeAvailability` no cambia ni una línea, y no habla con Google.
 *  · Si Google se cae, los bloqueos de la última sincronización siguen ahí:
 *    la disponibilidad degrada a "un poco vieja", nunca a "rota".
 *  · Las citas del CRM y los compromisos de fuera se restan igual, con la
 *    misma aritmética ya probada.
 *
 * Un bloqueo espejado se reconoce por `connector = "google"` + `externalRef`;
 * uno que puso el dueño a mano tiene `connector` en null y NUNCA se toca aquí.
 */

/** Cada cuánto vale la pena volver a preguntarle a Google. */
const FRESCURA_MS = 60_000;

/** Última sincronización por organización. En proceso: el trabajo de fondo de
 * Vocero también lo es (sin colas, ADR del núcleo). Reiniciar solo provoca una
 * sincronización de más. */
const ultimaSync = new Map<string, number>();

export type ResultadoSync =
  | { estado: "omitida"; motivo: "sin_conector" | "reciente" }
  | { estado: "ok"; creados: number; borrados: number }
  | { estado: "fallo"; error: string };

/**
 * PURA: qué hay que crear y qué hay que borrar para que los bloqueos espejados
 * digan lo mismo que el calendario. Sin BD ni red — se prueba sola.
 *
 * `ocupadosPorCita` son los ids de evento que YA pertenecen a una cita del CRM:
 * esos no se espejan. Sin ese filtro, la cita que el propio Vocero creó en
 * Google volvería como bloqueo encima de sí misma y chocaría con la llave
 * única anti doble-booking.
 */
export function planearEspejo(input: {
  eventos: EventoExterno[];
  espejadosActuales: { id: string; externalRef: string }[];
  ocupadosPorCita: Set<string>;
}): {
  crear: EventoExterno[];
  borrar: string[];
} {
  const vigentes = new Map(
    input.espejadosActuales.map((b) => [b.externalRef, b.id])
  );
  const deseados = input.eventos.filter((e) => !input.ocupadosPorCita.has(e.id));

  const crear = deseados.filter((e) => !vigentes.has(e.id));
  const deseadosIds = new Set(deseados.map((e) => e.id));
  const borrar = input.espejadosActuales
    .filter((b) => !deseadosIds.has(b.externalRef))
    .map((b) => b.id);

  return { crear, borrar };
}

/**
 * Sincroniza si hace falta. NUNCA lanza: quien la llama está a punto de
 * ofrecerle horarios a un cliente, y un fallo de Google no puede costar esa
 * respuesta.
 */
export async function sincronizarSiHaceFalta(
  organizationId: string,
  opts?: { now?: Date; forzar?: boolean }
): Promise<ResultadoSync> {
  const now = opts?.now ?? new Date();
  if (!opts?.forzar) {
    const previa = ultimaSync.get(organizationId);
    if (previa && now.getTime() - previa < FRESCURA_MS) {
      return { estado: "omitida", motivo: "reciente" };
    }
  }

  try {
    const settings = await getSettings(organizationId);
    if (settings.connector !== "google") {
      return { estado: "omitida", motivo: "sin_conector" };
    }
    const creds = await getGoogleCredentials(organizationId);
    if (!creds) return { estado: "omitida", motivo: "sin_conector" };

    const desde = new Date(now);
    const hastaISO = addDaysISO(
      todayInTz(now, settings.timezone),
      settings.maxDaysAhead + 1
    );
    const hasta = new Date(`${hastaISO}T00:00:00Z`);

    const eventos = await googleBusyEvents(creds, {
      fromUtc: desde,
      toUtc: hasta,
    });
    // Marca ANTES de escribir: si el guardado falla, no se reintenta en bucle
    // contra Google en cada mensaje del lead.
    ultimaSync.set(organizationId, now.getTime());

    const resultado = await aplicarEspejo(organizationId, eventos, {
      desde,
      hasta,
    });
    return { estado: "ok", ...resultado };
  } catch (err) {
    ultimaSync.set(organizationId, now.getTime());
    console.warn(`[agenda-externa] sincronización fallida: ${err}`);
    return { estado: "fallo", error: String(err) };
  }
}

async function aplicarEspejo(
  organizationId: string,
  eventos: EventoExterno[],
  ventana: { desde: Date; hasta: Date }
): Promise<{ creados: number; borrados: number }> {
  const db = getDb();

  const filas = await db
    .select({
      id: schema.booking.id,
      kind: schema.booking.kind,
      externalRef: schema.booking.externalRef,
      scheduledAt: schema.booking.scheduledAt,
    })
    .from(schema.booking)
    .where(
      scoped(
        schema.booking.organizationId,
        organizationId,
        and(
          isNotNull(schema.booking.externalRef),
          gte(schema.booking.scheduledAt, ventana.desde),
          lte(schema.booking.scheduledAt, ventana.hasta)
        )
      )
    );

  const espejadosActuales = filas
    .filter((f) => f.kind === "block")
    .map((f) => ({ id: f.id, externalRef: f.externalRef! }));
  const ocupadosPorCita = new Set(
    filas.filter((f) => f.kind === "session").map((f) => f.externalRef!)
  );

  const { crear, borrar } = planearEspejo({
    eventos,
    espejadosActuales,
    ocupadosPorCita,
  });

  if (crear.length > 0) {
    await db
      .insert(schema.booking)
      .values(
        crear.map((e) => ({
          id: newId("booking"),
          organizationId,
          kind: "block" as const,
          source: "manual" as const,
          scheduledAt: new Date(e.startUtc),
          durationMinutes: Math.max(
            1,
            Math.round(
              (Date.parse(e.endUtc) - Date.parse(e.startUtc)) / 60_000
            )
          ),
          connector: "google",
          externalRef: e.id,
          notes: e.titulo ? `Google Calendar · ${e.titulo}` : "Google Calendar",
        }))
      )
      // Dos huecos del calendario que empiezan en el mismo instante chocan con
      // la llave anti doble-booking. Con uno basta para tapar el hueco.
      .onConflictDoNothing();
  }

  for (const id of borrar) {
    await db
      .delete(schema.booking)
      .where(
        scoped(
          schema.booking.organizationId,
          organizationId,
          eq(schema.booking.id, id)
        )
      );
  }

  return { creados: crear.length, borrados: borrar.length };
}

/** Solo para tests: olvida la marca de frescura. */
export function olvidarFrescura(): void {
  ultimaSync.clear();
}

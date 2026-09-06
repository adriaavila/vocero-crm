import { describe, expect, it } from "vitest";
import { planearEspejo } from "@/server/agencia/agenda-externa";
import { normalizarEventos } from "@/server/agencia/google-eventos";

/**
 * El espejo del calendario externo (capa de agencia).
 *
 * Lo que se protege aquí es lo que rompe la confianza en un agente que agenda:
 * ofrecer un hueco que el dueño ya tiene ocupado, o al revés, vaciarle la
 * agenda por espejar cosas que no ocupan a nadie.
 */

const VENTANA = {
  fromUtc: new Date("2026-09-05T00:00:00Z"),
  toUtc: new Date("2026-09-12T00:00:00Z"),
};

describe("normalizarEventos", () => {
  it("toma los eventos que de verdad ocupan", () => {
    const out = normalizarEventos(
      {
        items: [
          {
            id: "ev_1",
            summary: "Junta con proveedor",
            start: { dateTime: "2026-09-08T15:00:00Z" },
            end: { dateTime: "2026-09-08T16:00:00Z" },
          },
        ],
      },
      VENTANA
    );
    expect(out).toEqual([
      {
        id: "ev_1",
        startUtc: "2026-09-08T15:00:00.000Z",
        endUtc: "2026-09-08T16:00:00.000Z",
        titulo: "Junta con proveedor",
      },
    ]);
  });

  it("ignora cancelados y los marcados como disponible", () => {
    // Un cumpleaños o un recordatorio viven en el calendario con
    // `transparency: transparent`. Bloquear por ellos deja al negocio sin
    // huecos sin que nadie entienda por qué.
    const out = normalizarEventos(
      {
        items: [
          {
            id: "ev_cancelado",
            status: "cancelled",
            start: { dateTime: "2026-09-08T15:00:00Z" },
            end: { dateTime: "2026-09-08T16:00:00Z" },
          },
          {
            id: "ev_cumple",
            transparency: "transparent",
            start: { dateTime: "2026-09-09T15:00:00Z" },
            end: { dateTime: "2026-09-09T16:00:00Z" },
          },
        ],
      },
      VENTANA
    );
    expect(out).toEqual([]);
  });

  it("recorta un evento de día completo a la ventana", () => {
    const out = normalizarEventos(
      {
        items: [
          {
            id: "ev_vacaciones",
            summary: "Vacaciones",
            start: { date: "2026-09-01" },
            end: { date: "2026-10-01" },
          },
        ],
      },
      VENTANA
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.startUtc).toBe(VENTANA.fromUtc.toISOString());
    expect(out[0]!.endUtc).toBe(VENTANA.toUtc.toISOString());
  });

  it("descarta lo que termina antes de empezar o cae fuera", () => {
    const out = normalizarEventos(
      {
        items: [
          {
            id: "ev_pasado",
            start: { dateTime: "2026-08-01T15:00:00Z" },
            end: { dateTime: "2026-08-01T16:00:00Z" },
          },
          { id: "ev_sin_horas" },
        ],
      },
      VENTANA
    );
    expect(out).toEqual([]);
  });
});

describe("planearEspejo", () => {
  const evento = (id: string): Parameters<typeof planearEspejo>[0]["eventos"][number] => ({
    id,
    startUtc: "2026-09-08T15:00:00.000Z",
    endUtc: "2026-09-08T16:00:00.000Z",
    titulo: id,
  });

  it("crea lo que falta y no duplica lo que ya está", () => {
    const plan = planearEspejo({
      eventos: [evento("ev_1"), evento("ev_2")],
      espejadosActuales: [{ id: "bk_a", externalRef: "ev_1" }],
      ocupadosPorCita: new Set(),
    });
    expect(plan.crear.map((e) => e.id)).toEqual(["ev_2"]);
    expect(plan.borrar).toEqual([]);
  });

  it("borra el bloqueo de un evento que ya no existe", () => {
    const plan = planearEspejo({
      eventos: [],
      espejadosActuales: [{ id: "bk_a", externalRef: "ev_1" }],
      ocupadosPorCita: new Set(),
    });
    expect(plan.crear).toEqual([]);
    expect(plan.borrar).toEqual(["bk_a"]);
  });

  it("no espeja el evento que ES una cita del CRM", () => {
    // La cita que Vocero creó en Google vuelve por la lista de eventos. Si se
    // espejara, chocaría con la llave única anti doble-booking contra la
    // propia cita — y el motor reportaría el hueco como ocupado dos veces.
    const plan = planearEspejo({
      eventos: [evento("ev_de_una_cita")],
      espejadosActuales: [],
      ocupadosPorCita: new Set(["ev_de_una_cita"]),
    });
    expect(plan.crear).toEqual([]);
  });

  it("retira el espejo si el evento pasó a ser una cita del CRM", () => {
    const plan = planearEspejo({
      eventos: [evento("ev_1")],
      espejadosActuales: [{ id: "bk_a", externalRef: "ev_1" }],
      ocupadosPorCita: new Set(["ev_1"]),
    });
    expect(plan.crear).toEqual([]);
    expect(plan.borrar).toEqual(["bk_a"]);
  });
});

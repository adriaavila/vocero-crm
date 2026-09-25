import { describe, expect, it } from "vitest";
import { inboundByDay } from "@/server/overview";

/**
 * «Mensajes que entraron» (Inicio) cuenta por día EN LA ZONA DEL NEGOCIO.
 *
 * El fallo que fija: en días UTC, el jueves 21:10 de Caracas ya es viernes
 * 01:10, así que la última barra (la de «hoy») decía «vie» y lo que entró esa
 * noche contaba para el día siguiente.
 */

/** Jueves 24 de septiembre de 2026, 21:10 en Caracas (UTC−4). */
const JUEVES_NOCHE = new Date("2026-09-25T01:10:00Z");

describe("mensajes que entraron, por día del negocio", () => {
  it("el mensaje del jueves en la noche cuenta para el jueves, y hoy es jueves", () => {
    const trend = inboundByDay([{ at: JUEVES_NOCHE, count: 1 }], "America/Caracas", JUEVES_NOCHE);
    expect(trend.map((p) => p.date)).toEqual([
      "2026-09-18",
      "2026-09-19",
      "2026-09-20",
      "2026-09-21",
      "2026-09-22",
      "2026-09-23",
      "2026-09-24",
    ]);
    expect(trend.at(-1)).toEqual({ date: "2026-09-24", count: 1 });
  });

  it("la semana empieza a la medianoche local", () => {
    const trend = inboundByDay(
      [
        { at: new Date("2026-09-18T03:00:00Z"), count: 5 }, // jue 17, 23:00 en Caracas: fuera
        { at: new Date("2026-09-18T04:00:00Z"), count: 2 }, // vie 18, 00:00: primer día
      ],
      "America/Caracas",
      JUEVES_NOCHE,
    );
    expect(trend[0]).toEqual({ date: "2026-09-18", count: 2 });
    expect(trend.reduce((sum, p) => sum + p.count, 0)).toBe(2);
  });

  it("sin una zona válida, cuenta en UTC", () => {
    for (const zona of [undefined, "", "Marte/Olympus"]) {
      const trend = inboundByDay([{ at: JUEVES_NOCHE, count: 1 }], zona, JUEVES_NOCHE);
      expect(trend.at(-1)).toEqual({ date: "2026-09-25", count: 1 });
    }
  });
});

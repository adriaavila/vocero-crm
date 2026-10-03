import { describe, expect, it } from "vitest";
import { centroPeriod, currentHour, fillSeries, HOURS, parsePeriod } from "@/server/agencia/centro-metricas";

/**
 * Los números de Inicio cuentan en la zona del NEGOCIO: el día cambia a su
 * medianoche, no a la de UTC. Lo que lee la base (quién cuenta, el rango
 * semiabierto) está en centro-realdb.test.ts.
 */

describe("?p= de la URL", () => {
  it("acepta los cuatro periodos", () => {
    for (const p of ["hoy", "7d", "30d", "90d"]) expect(parsePeriod(p)).toBe(p);
  });
  it("cualquier otra cosa cae en 7 días", () => {
    for (const p of [undefined, null, "", "1y", "7D", "hoy;drop", ["30d", "7d"].toString()]) {
      expect(parsePeriod(p as string | undefined)).toBe("7d");
    }
  });
  it("si llega repetido, vale el primero", () => {
    expect(parsePeriod(["30d", "hoy"])).toBe("30d");
  });
});

describe("el periodo en la zona del negocio", () => {
  const CARACAS = "America/Caracas"; // UTC−4 todo el año

  it("«hoy» es el día local: de su medianoche a la siguiente", () => {
    const p = centroPeriod("hoy", CARACAS, new Date("2026-10-03T18:00:00Z"));
    expect(p.dto).toMatchObject({ from: "2026-10-03", to: "2026-10-03", days: 1 });
    expect(p.start.toISOString()).toBe("2026-10-03T04:00:00.000Z");
    expect(p.end.toISOString()).toBe("2026-10-04T04:00:00.000Z");
  });

  it("23:59:59 local sigue siendo ayer; a las 00:00 local ya es hoy", () => {
    const antes = centroPeriod("hoy", CARACAS, new Date("2026-10-04T03:59:59Z"));
    const despues = centroPeriod("hoy", CARACAS, new Date("2026-10-04T04:00:00Z"));
    expect(antes.dto.to).toBe("2026-10-03");
    expect(despues.dto.to).toBe("2026-10-04");
  });

  it("el jueves 21:10 en Caracas no es viernes (en UTC sí lo sería)", () => {
    const p = centroPeriod("7d", CARACAS, new Date("2026-09-25T01:10:00Z"));
    expect(p.dto.to).toBe("2026-09-24");
  });

  it("7, 30 y 90 días son los últimos N que terminan hoy, hoy incluido", () => {
    const now = new Date("2026-10-03T18:00:00Z");
    expect(centroPeriod("7d", CARACAS, now).dto).toMatchObject({ from: "2026-09-27", to: "2026-10-03", days: 7 });
    expect(centroPeriod("30d", CARACAS, now).dto).toMatchObject({ from: "2026-09-04", to: "2026-10-03", days: 30 });
    expect(centroPeriod("90d", CARACAS, now).dto).toMatchObject({ from: "2026-07-06", to: "2026-10-03", days: 90 });
  });

  it("90 días siguen en barras diarias (el corte a meses es de Resultados, a más de 92)", () => {
    expect(centroPeriod("90d", CARACAS, new Date("2026-10-03T18:00:00Z")).dto.granularity).toBe("day");
  });

  it("el fin es exclusivo: la medianoche siguiente no cuenta para hoy", () => {
    const p = centroPeriod("30d", CARACAS, new Date("2026-10-03T18:00:00Z"));
    expect(p.end.toISOString()).toBe("2026-10-04T04:00:00.000Z");
    expect(p.start.toISOString()).toBe("2026-09-04T04:00:00.000Z");
  });

  it("un día con cambio de hora dura 25 h (fin del horario de verano en Nueva York)", () => {
    const p = centroPeriod("hoy", "America/New_York", new Date("2026-11-01T15:00:00Z"));
    expect(p.dto.to).toBe("2026-11-01");
    expect(p.end.getTime() - p.start.getTime()).toBe(25 * 3_600_000);
  });

  it("una zona inválida cae en la de por defecto en vez de tumbar la pantalla", () => {
    expect(() => centroPeriod("7d", "Marte/Olimpo", new Date("2026-10-03T18:00:00Z"))).not.toThrow();
  });
});

describe("la serie", () => {
  it("rellena con 0 los cubos sin datos y no pierde los que sí tienen", () => {
    const out = fillSeries(["2026-10-01", "2026-10-02", "2026-10-03"], [{ label: "2026-10-02", count: 4 }]);
    expect(out).toEqual([
      { label: "2026-10-01", count: 0 },
      { label: "2026-10-02", count: 4 },
      { label: "2026-10-03", count: 0 },
    ]);
  });
  it("ignora cubos fuera del rango en vez de inventarlos", () => {
    expect(fillSeries(["a"], [{ label: "b", count: 9 }])).toEqual([{ label: "a", count: 0 }]);
  });
  it("«hoy» tiene 24 horas, de 00 a 23", () => {
    expect(HOURS).toHaveLength(24);
    expect(HOURS[0]).toBe("00");
    expect(HOURS[23]).toBe("23");
  });
});

describe("el cubo de ahora", () => {
  it("la hora local del negocio, no la de UTC", () => {
    expect(currentHour(new Date("2026-10-03T18:05:00Z"), "America/Caracas")).toBe("14");
    expect(currentHour(new Date("2026-10-04T04:00:00Z"), "America/Caracas")).toBe("00");
    expect(currentHour(new Date("2026-10-04T03:59:00Z"), "America/Caracas")).toBe("23");
  });
});

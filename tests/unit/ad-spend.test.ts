import { describe, expect, it } from "vitest";
import { adReturn, moneyPerUnit } from "@/lib/analytics";
import { proratedCents } from "@/server/analytics/ad-spend";

/**
 * Fork — gasto de anuncios (Cloud lo tiene, upstream no).
 *
 * `proratedCents` es la única aritmética con fecha del feature: se prueba
 * sola, en los bordes, porque un error de un día ahí no lo cacha ni
 * typecheck ni build, solo se ve en una tarjeta que no cuadra.
 */

describe("proratedCents", () => {
  it("el rango de la carga cabe entero en el periodo: se cuenta completo", () => {
    const entry = { periodStart: "2026-01-01", periodEnd: "2026-01-31", amountCents: 3100 };
    expect(proratedCents(entry, "2026-01-01", "2026-01-31")).toBe(3100);
  });

  it("prorratea por los días de traslape, no por los días de la carga", () => {
    // 31 días a 100/día; el periodo solo mira los primeros 10.
    const entry = { periodStart: "2026-01-01", periodEnd: "2026-01-31", amountCents: 3100 };
    expect(proratedCents(entry, "2026-01-01", "2026-01-10")).toBe(1000);
  });

  it("la carga empieza antes del periodo y el traslape es solo la cola", () => {
    // 17 días (15-31) a 100/día; el periodo corta el 20: traslape = 15..20 = 6 días.
    const entry = { periodStart: "2026-01-15", periodEnd: "2026-01-31", amountCents: 1700 };
    expect(proratedCents(entry, "2026-01-01", "2026-01-20")).toBe(600);
  });

  it("la carga termina después del periodo y el traslape es solo la cabeza", () => {
    // 20 días (1-20) a 100/día; el periodo arranca el 15: traslape = 15..20 = 6 días.
    const entry = { periodStart: "2026-01-01", periodEnd: "2026-01-20", amountCents: 2000 };
    expect(proratedCents(entry, "2026-01-15", "2026-01-31")).toBe(600);
  });

  it("sin traslape, cero — no importa qué tan grande sea la carga", () => {
    const entry = { periodStart: "2026-01-01", periodEnd: "2026-01-10", amountCents: 500_000 };
    expect(proratedCents(entry, "2026-02-01", "2026-02-28")).toBe(0);
  });

  it("un día exacto de borde SÍ cuenta (inclusivo en los dos extremos)", () => {
    const entry = { periodStart: "2026-01-01", periodEnd: "2026-01-10", amountCents: 1000 };
    // El periodo empieza justo el último día de la carga: 1 día de traslape.
    expect(proratedCents(entry, "2026-01-10", "2026-01-20")).toBe(100);
  });

  it("una carga de un solo día cuenta entera si ese día está en el periodo", () => {
    const entry = { periodStart: "2026-01-05", periodEnd: "2026-01-05", amountCents: 500 };
    expect(proratedCents(entry, "2026-01-01", "2026-01-31")).toBe(500);
  });

  it("redondea al centavo más cercano, no lo trunca", () => {
    // 100 centavos repartidos en 3 días = 33.33.../día; 1 día de traslape.
    const entry = { periodStart: "2026-01-01", periodEnd: "2026-01-03", amountCents: 100 };
    expect(proratedCents(entry, "2026-01-01", "2026-01-01")).toBe(33);
  });

  it("el periodo consultado puede ser más largo que la carga entera", () => {
    const entry = { periodStart: "2026-01-10", periodEnd: "2026-01-12", amountCents: 300 };
    expect(proratedCents(entry, "2026-01-01", "2026-12-31")).toBe(300);
  });
});

describe("moneyPerUnit", () => {
  it("sin denominador, cents es null (no cero): 'sin datos' no es lo mismo que 'gratis'", () => {
    expect(moneyPerUnit(50_000, 0)).toEqual({ cents: null, sample: 0, reliable: false });
  });

  it("divide y redondea, y carga la muestra", () => {
    expect(moneyPerUnit(1000, 3)).toEqual({ cents: 333, sample: 3, reliable: false });
  });

  it("marca poco fiable bajo el mínimo de muestra, fiable en o sobre él", () => {
    expect(moneyPerUnit(10_000, 9).reliable).toBe(false);
    expect(moneyPerUnit(10_000, 10).reliable).toBe(true);
  });
});

describe("adReturn", () => {
  it("sin gasto, multiple es null: nada que dividir", () => {
    expect(adReturn(50_000, 0, 5)).toEqual({ multiple: null, sample: 0, reliable: false });
  });

  it("gastar 100 y ganar 250 es un retorno de 2.5x", () => {
    expect(adReturn(25_000, 10_000, 12)).toEqual({ multiple: 2.5, sample: 12, reliable: true });
  });

  it("sin ninguna venta todavía, el retorno es 0x, no null (sí hubo gasto)", () => {
    expect(adReturn(0, 10_000, 0)).toEqual({ multiple: 0, sample: 0, reliable: false });
  });

  it("la muestra es de tratos ganados, no de centavos gastados", () => {
    // Gasto grande, pocos tratos: sigue "poco fiable" aunque el dinero sea mucho.
    expect(adReturn(1_000_000, 500_000, 2).reliable).toBe(false);
  });
});

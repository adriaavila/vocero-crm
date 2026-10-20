import { describe, expect, it } from "vitest";
import {
  calcularCuotas,
  formatoMonto,
  fraseAlquiler,
  PlanInvalido,
  validarPlan,
  type PlanPago,
} from "@/lib/sala-cuotas";
import { palabrasProhibidas } from "@/lib/sala-palabras";
import { llamarHoy, puntuarSala } from "@/lib/sala-senal";

/** Plan A-2 de Santorini: reserva, 30 % a los 15 días, 70 % contra entrega. */
const ESTANDAR: PlanPago = {
  nombre: "Estándar",
  reserva: 3000,
  mesEntrega: 2,
  pasos: [
    { tipo: "unico", etiqueta: "Cuota inicial", porcentaje: 30, mes: 0 },
    { tipo: "unico", etiqueta: "Saldo contra entrega", porcentaje: 70, mes: 2 },
  ],
};

const PREVENTA: PlanPago = {
  nombre: "Preventa",
  reserva: 3000,
  mesEntrega: 12,
  pasos: [
    { tipo: "unico", etiqueta: "Cuota inicial", porcentaje: 20, mes: 0 },
    { tipo: "mensual", etiqueta: "Cuota de obra", porcentaje: 30, desdeMes: 1, hastaMes: 12 },
    { tipo: "unico", etiqueta: "Saldo contra entrega", porcentaje: 50, mes: 12 },
  ],
};

describe("calcularCuotas", () => {
  it("descuenta la reserva del primer paso y suma el precio exacto", () => {
    const c = calcularCuotas(120000, ESTANDAR);
    expect(c.pagos).toEqual([
      { mes: 0, etiqueta: "Reserva", monto: 3000 },
      { mes: 0, etiqueta: "Cuota inicial", monto: 33000 },
      { mes: 2, etiqueta: "Saldo contra entrega", monto: 84000 },
    ]);
    expect(c.total).toBe(120000);
    expect(c.cuotaMensual).toBeNull();
  });

  it("reparte la cuota mensual sin perder centavos", () => {
    const c = calcularCuotas(125000.01, PREVENTA, 400);
    const suma = c.pagos.reduce((s, p) => s + Math.round(p.monto * 100), 0);
    expect(suma).toBe(12500001);
    expect(c.pagos.filter((p) => p.etiqueta.startsWith("Cuota de obra"))).toHaveLength(12);
    expect(c.cuotaMensual).toBeCloseTo(3125, 0);
    expect(c.alquilerHastaEntrega).toBe(4800);
    expect(c.coberturaCuota).toBe(13);
  });

  it("rechaza un plan que no suma 100", () => {
    const malo = { ...ESTANDAR, pasos: [ESTANDAR.pasos[0]!] };
    expect(validarPlan(malo)[0]).toMatch(/suman 30/);
    expect(() => calcularCuotas(120000, malo)).toThrow(PlanInvalido);
  });

  it("rechaza un precio cero", () => {
    expect(() => calcularCuotas(0, ESTANDAR)).toThrow(PlanInvalido);
  });
});

describe("fraseAlquiler", () => {
  it("habla de la cuota cuando el plan tiene cuotas mensuales", () => {
    const c = calcularCuotas(120000, PREVENTA, 400);
    expect(fraseAlquiler(c, "USD")).toBe(
      "Lo que hoy pagas de alquiler cubre el 13 % de tu cuota mensual de US$ 3.000."
    );
  });

  it("habla del alquiler hasta la entrega cuando no hay cuotas", () => {
    const c = calcularCuotas(120000, ESTANDAR, 500);
    expect(fraseAlquiler(c, "USD")).toMatch(/^Hasta la entrega pagarías US\$ 1\.000/);
  });

  it("no dice nada sin alquiler", () => {
    expect(fraseAlquiler(calcularCuotas(120000, ESTANDAR), "USD")).toBeNull();
  });

  it("nunca usa una palabra prohibida", () => {
    const frases = [
      fraseAlquiler(calcularCuotas(120000, PREVENTA, 400), "USD"),
      fraseAlquiler(calcularCuotas(120000, PREVENTA, 9000), "USD"),
      fraseAlquiler(calcularCuotas(120000, ESTANDAR, 500), "USD"),
    ];
    for (const frase of frases) expect(palabrasProhibidas(frase ?? "")).toEqual([]);
  });
});

describe("formatoMonto", () => {
  it("usa separadores de Bolivia", () => {
    expect(formatoMonto(1234.5, "BOB")).toBe("Bs 1.234,50");
    expect(formatoMonto(120000, "USD")).toBe("US$ 120.000");
  });
});

describe("palabrasProhibidas", () => {
  it("encuentra palabras enteras sin importar tildes ni mayúsculas", () => {
    expect(palabrasProhibidas("Una gran INVERSION con buena Renta")).toEqual([
      "renta",
      "inversión",
    ]);
    expect(palabrasProhibidas("ROI del 12 %")).toEqual(["roi"]);
  });

  it("no confunde palabras que solo contienen las prohibidas", () => {
    expect(palabrasProhibidas("Parrillero, patio y terreno propio")).toEqual([]);
    expect(palabrasProhibidas("Precio fijado desde la firma")).toEqual([]);
  });
});

describe("llamarHoy", () => {
  const ahora = new Date("2026-10-20T15:00:00Z");
  const hace = (dias: number) => new Date(ahora.getTime() - dias * 86400000);
  const nada = { aperturas: 0, ultimaAperturaAt: null, calculadoraAt: null, visitaPedidaAt: null };

  it("pone primero a quien pidió visitar y explica por qué", () => {
    const lista = llamarHoy(
      [
        { id: "a", ...nada, aperturas: 3, ultimaAperturaAt: hace(1) },
        { id: "b", ...nada, aperturas: 1, ultimaAperturaAt: hace(0), visitaPedidaAt: hace(0) },
        { id: "c", ...nada },
      ],
      ahora
    );
    expect(lista.map((s) => s.id)).toEqual(["b", "a"]);
    expect(lista[0]!.motivo).toBe("Pidió visitar y abrió su sala");
    expect(lista[1]!.motivo).toBe("Abrió su sala 3 veces");
  });

  it("olvida la señal vieja", () => {
    expect(
      puntuarSala({ ...nada, aperturas: 4, ultimaAperturaAt: hace(20), calculadoraAt: hace(20) }, ahora)
    ).toEqual({ puntos: 0, motivo: null });
  });
});

import { describe, expect, it } from "vitest";
import { textoResumenDia } from "@/lib/avisos";

describe("resumen diario — texto", () => {
  it("un día sin clientes no se avisa", () => {
    expect(textoResumenDia({ clientes: 0, respuestas: 0, citas: 0, teEsperan: 0 })).toBeNull();
  });

  it("dice lo que hizo el agente y si alguien te espera", () => {
    expect(textoResumenDia({ clientes: 12, respuestas: 34, citas: 2, teEsperan: 3 })).toEqual({
      title: "Hoy te escribieron 12 clientes",
      body: "Tu agente contestó 34 mensajes y agendó 2 citas. 3 conversaciones te esperan.",
    });
    expect(textoResumenDia({ clientes: 1, respuestas: 1, citas: 0, teEsperan: 0 })).toEqual({
      title: "Hoy te escribió 1 cliente",
      body: "Tu agente contestó 1 mensaje. Nadie te espera.",
    });
    expect(textoResumenDia({ clientes: 2, respuestas: 0, citas: 0, teEsperan: 1 })?.body).toBe(
      "Tu agente no contestó ninguno. 1 conversación te espera."
    );
  });
});

describe("resumen del día: la plata primero", () => {
  it("con valor por cita, el título dice cuánto trajo el agente", () => {
    expect(
      textoResumenDia({ clientes: 9, respuestas: 30, citas: 3, teEsperan: 1, valorCitasCents: 180000, ventas: { count: 0, cents: 0 }, currency: "MXN" }),
    ).toEqual({ title: "Tu agente te trajo unos $1,800 hoy", body: "Agendó 3 citas ($1,800), te escribieron 9 clientes. 1 conversación te espera." });
  });
  it("suma las ventas cerradas del día", () => {
    expect(
      textoResumenDia({ clientes: 2, respuestas: 4, citas: 1, teEsperan: 0, valorCitasCents: 50000, ventas: { count: 1, cents: 1200000 }, currency: "MXN" })?.title,
    ).toBe("Tu agente te trajo unos $12,500 hoy");
  });
  it("sin valor por cita no inventa plata, pero una venta sí se cuenta", () => {
    expect(textoResumenDia({ clientes: 0, respuestas: 0, citas: 0, teEsperan: 0, ventas: { count: 2, cents: 300000 }, currency: "MXN" })).toEqual({
      title: "Hoy cerraste 2 ventas por $3,000",
      body: "Nadie te espera.",
    });
    expect(textoResumenDia({ clientes: 3, respuestas: 5, citas: 2, teEsperan: 0, valorCitasCents: null, currency: "MXN" })?.title).toBe(
      "Hoy te escribieron 3 clientes",
    );
  });
});

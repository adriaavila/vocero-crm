import { describe, expect, it } from "vitest";
import { palabrasProhibidas, usaProhibida } from "@/server/agencia/palabras-prohibidas";

/** Las instrucciones de SAMER (Rei), tal como las escribió el dueño. */
const SAMER = `Cómo hablas:
- Español de Tarija, con tuteo.
- Nunca usas las palabras renta, rendimiento, retorno, interés, ganancia, plusvalía ni inversión segura.
- Nunca prometes descuentos. Nunca dices "últimas unidades" ni inventas urgencia.`;

describe("palabrasProhibidas", () => {
  it("lee la lista y las frases entre comillas de SAMER", () => {
    expect(palabrasProhibidas(SAMER)).toEqual([
      "renta",
      "rendimiento",
      "retorno",
      "interés",
      "ganancia",
      "plusvalía",
      "inversión segura",
      "últimas unidades",
    ]);
  });

  it("sin instrucciones o sin lista, nada", () => {
    expect(palabrasProhibidas(null)).toEqual([]);
    expect(palabrasProhibidas("Saluda con cariño. Habla de usted.")).toEqual([]);
  });

  it("«no uses los términos: X, Y» también cuenta", () => {
    expect(palabrasProhibidas("No uses los términos: barato, oferta.")).toEqual(["barato", "oferta"]);
  });
});

describe("usaProhibida", () => {
  const p = palabrasProhibidas(SAMER);

  it("encuentra la palabra aunque cambie la tilde o vaya en plural", () => {
    expect(usaProhibida("Lo del rendimiento del alquiler te lo responde Marcelo.", p)).toBe("rendimiento");
    expect(usaProhibida("Sin plusvalia asegurada", p)).toBe("plusvalía");
    expect(usaProhibida("Las rentas van al dueño", p)).toBe("renta");
    expect(usaProhibida("Son las Últimas Unidades", p)).toBe("últimas unidades");
  });

  it("no salta dentro de otra palabra", () => {
    expect(usaProhibida("¿Te interesa una casa en Santorini?", p)).toBeNull();
    expect(usaProhibida("Es para tu parentela, ¿no?", p)).toBeNull();
    expect(usaProhibida("Reserva con $us 3.000", p)).toBeNull();
  });
});

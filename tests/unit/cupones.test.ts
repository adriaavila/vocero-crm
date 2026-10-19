import { describe, expect, it } from "vitest";
import { buscarCupon, parseCupones } from "@/server/agencia/cupones";

describe("cupones de plan gratis", () => {
  it("lee CODIGO:plan[:usos] y solo acepta planes que se venden", () => {
    expect(parseCupones("samer:inmobiliaria:3, PILOTO:inmobiliaria ,OTRO:pro", ["inmobiliaria"])).toEqual([
      { codigo: "SAMER", plan: "inmobiliaria", usos: 3 },
      { codigo: "PILOTO", plan: "inmobiliaria", usos: null },
    ]);
  });

  it("ignora lo mal escrito en vez de abrir un plan por error", () => {
    expect(parseCupones("X:inmobiliaria,SAMER:inmo,SAMER:inmobiliaria:0,SAMER:inmobiliaria:dos", ["inmobiliaria"])).toEqual([]);
    expect(parseCupones(undefined, ["inmobiliaria"])).toEqual([]);
    expect(parseCupones("  ", ["inmobiliaria"])).toEqual([]);
  });

  it("encuentra el código sin importar mayúsculas ni espacios", () => {
    const cupones = parseCupones("SAMER:inmobiliaria", ["inmobiliaria"]);
    expect(buscarCupon(" samer ", cupones)?.plan).toBe("inmobiliaria");
    expect(buscarCupon("SAMERX", cupones)).toBeNull();
  });
});

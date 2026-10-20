import { describe, expect, it } from "vitest";
import { countVariables } from "@/lib/templates";
import {
  horaDeRecuperar,
  normalizarRecuperar,
  primerNombre,
  RECUPERAR_PLANTILLA,
  recuperarLabel,
  variablesRecuperar,
} from "@/lib/recuperar";

describe("recuperar clientes — reglas puras", () => {
  it("0, vacío o raro apaga; los días válidos pasan", () => {
    expect(normalizarRecuperar(0)).toBeNull();
    expect(normalizarRecuperar(null)).toBeNull();
    expect(normalizarRecuperar("x")).toBeNull();
    expect(normalizarRecuperar(-3)).toBeNull();
    expect(normalizarRecuperar(400)).toBeNull();
    expect(normalizarRecuperar(90)).toBe(90);
    expect(normalizarRecuperar("60")).toBe(60);
  });

  it("la etiqueta marca el recomendado y el apagado", () => {
    expect(recuperarLabel(0)).toBe("No les escribas");
    expect(recuperarLabel(90)).toContain("(recomendado)");
    expect(recuperarLabel(45)).not.toContain("recomendado");
  });

  it("solo de 10:00 a 19:00", () => {
    expect(horaDeRecuperar(9)).toBe(false);
    expect(horaDeRecuperar(10)).toBe(true);
    expect(horaDeRecuperar(18)).toBe(true);
    expect(horaDeRecuperar(19)).toBe(false);
  });

  it("el primer nombre si parece nombre; si no, un saludo que se lee bien", () => {
    expect(primerNombre("maría josé pérez")).toBe("María");
    expect(primerNombre("+52 55 1234 5678")).toBe("👋");
    expect(primerNombre("")).toBe("👋");
    expect(primerNombre(null)).toBe("👋");
    expect(primerNombre("🌸 Ana")).toBe("👋");
  });

  it("llena {{1}} con el cliente y {{2}} con el negocio; más de dos no sabe", () => {
    expect(variablesRecuperar(0, "Ana", "Spa Luna")).toEqual([]);
    expect(variablesRecuperar(1, "ana", "Spa Luna")).toEqual(["Ana"]);
    expect(variablesRecuperar(2, "Ana", "Spa Luna")).toEqual(["Ana", "Spa Luna"]);
    expect(variablesRecuperar(2, "Ana", " ")).toEqual(["Ana", "nuestro negocio"]);
    expect(variablesRecuperar(3, "Ana", "Spa Luna")).toBeNull();
  });

  it("la plantilla propuesta usa justo las dos variables que sabemos llenar", () => {
    expect(countVariables(RECUPERAR_PLANTILLA.body)).toBe(2);
    expect(RECUPERAR_PLANTILLA.category).toBe("MARKETING");
  });
});

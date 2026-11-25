import { describe, expect, it } from "vitest";
import { clientePidioVisita, etapaParaVisita } from "@/server/agencia/visita-pipeline";

const st = (id: string, name: string, position: number, kind = "open") => ({ id, name, kind, position });

/** Las etapas con que nace un negocio (`on-signup.ts`). */
const DEFAULT = [
  st("nuevo", "Nuevo", 0),
  st("conv", "En conversación", 1),
  st("int", "Interesado", 2),
  st("cli", "Cliente", 3, "won"),
  st("per", "Perdido", 4, "lost"),
];

/** Un embudo inmobiliario con etapas de visita. */
const INMO = [
  st("nuevo", "Nuevo", 0),
  st("calif", "Calificado", 1),
  st("vpc", "Visita por coordinar", 2),
  st("vag", "Visita agendada", 3),
  st("neg", "Negociación", 4),
  st("res", "Reservó", 5, "won"),
  st("per", "Perdido", 6, "lost"),
];

describe("etapaParaVisita", () => {
  it("va a «Visita por coordinar» cuando existe", () => {
    expect(etapaParaVisita(INMO, "nuevo")).toBe("vpc");
    expect(etapaParaVisita(INMO, "calif")).toBe("vpc");
  });

  it("sin etapa de visita, va a la última abierta", () => {
    expect(etapaParaVisita(DEFAULT, "nuevo")).toBe("int");
    expect(etapaParaVisita(DEFAULT, "conv")).toBe("int");
  });

  it("nunca retrocede", () => {
    expect(etapaParaVisita(INMO, "vpc")).toBeNull();
    expect(etapaParaVisita(INMO, "vag")).toBeNull();
    expect(etapaParaVisita(INMO, "neg")).toBeNull();
    expect(etapaParaVisita(DEFAULT, "int")).toBeNull();
  });

  it("no saca a un lead ganado o perdido", () => {
    expect(etapaParaVisita(INMO, "res")).toBeNull();
    expect(etapaParaVisita(INMO, "per")).toBeNull();
    expect(etapaParaVisita(DEFAULT, "cli")).toBeNull();
  });

  it("con una sola etapa de visita que ya es «agendada», no la usa ni salta a la última", () => {
    const solo = [st("nuevo", "Nuevo", 0), st("vag", "Visita agendada", 1), st("neg", "Negociación", 2)];
    expect(etapaParaVisita(solo, "nuevo")).toBeNull();
  });

  it("una etapa llamada solo «Visita» sirve", () => {
    const simple = [st("nuevo", "Nuevo", 0), st("v", "Visita", 1), st("neg", "Negociación", 2)];
    expect(etapaParaVisita(simple, "nuevo")).toBe("v");
  });

  it("respeta la posición, no el orden en que llegan", () => {
    expect(etapaParaVisita([...INMO].reverse(), "nuevo")).toBe("vpc");
  });

  it("sin etapas abiertas no hace nada", () => {
    expect(etapaParaVisita([st("w", "Cliente", 0, "won")], null)).toBeNull();
  });
});

describe("clientePidioVisita", () => {
  it.each([
    ["quiero visitar la casa"],
    ["¿Puedo ir a ver la vivienda 2 el sábado?"],
    ["me gustaría conocerla"],
    ["¿tienen casa modelo?"],
  ])("sí: %s", (t) => {
    expect(clientePidioVisita([null, t])).toBe(true);
  });

  it("no, si nadie habló de ir a verla", () => {
    expect(clientePidioVisita(["¿cuánto cuesta?", "¿tiene garaje?", null, undefined])).toBe(false);
  });
});

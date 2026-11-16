import { describe, expect, it } from "vitest";
import { casasNombradas, normalizar, tarjetaYaEnviada } from "@/lib/sala-agente";

const CATALOGO = [
  { id: "p2", titulo: "Vivienda 2" },
  { id: "p5", titulo: "Vivienda 5" },
  { id: "p6", titulo: "Vivienda 6" },
  { id: "p23", titulo: "Vivienda 23" },
  { id: "p3b", titulo: "Departamento 3B" },
  { id: "suelta", titulo: "Casa" },
];
const ids = (r: { id: string }[]) => r.map((c) => c.id);

describe("casasNombradas", () => {
  it("una casa nombrada en la respuesta → su tarjeta", () => {
    expect(ids(casasNombradas("La Vivienda 2 cuesta $us 120.000 y se entrega en noviembre.", CATALOGO))).toEqual(["p2"]);
  });

  it("sin importar mayúsculas, tildes ni negritas de WhatsApp", () => {
    expect(ids(casasNombradas("Te cuento de la *VIVIENDA 5*: 148 m²", CATALOGO))).toEqual(["p5"]);
    expect(ids(casasNombradas("el departamento 3b está listo", CATALOGO))).toEqual(["p3b"]);
  });

  it("«Vivienda 2» no es «Vivienda 23»", () => {
    expect(ids(casasNombradas("La Vivienda 23 es la más grande", CATALOGO))).toEqual(["p23"]);
  });

  it("dos casas → dos tarjetas", () => {
    expect(ids(casasNombradas("Te sirven la Vivienda 5 o la Vivienda 6, las dos en diciembre.", CATALOGO))).toEqual([
      "p5",
      "p6",
    ]);
  });

  it("tres o más es un menú: ninguna tarjeta", () => {
    const menu = "Disponibles: Vivienda 2, Vivienda 5 y Vivienda 6. ¿Cuál te interesa?";
    expect(casasNombradas(menu, CATALOGO)).toEqual([]);
  });

  it("un título de una sola palabra no cuenta (aparece en cualquier frase)", () => {
    expect(casasNombradas("Es una casa muy linda", CATALOGO)).toEqual([]);
  });

  it("una casa que ya recibió tarjeta en el chat no se repite", () => {
    expect(casasNombradas("La Vivienda 2, como te mostré", CATALOGO, new Set(["p2"]))).toEqual([]);
  });

  it("sin casas nombradas, nada", () => {
    expect(casasNombradas("¿Te cuadra una visita esta semana?", CATALOGO)).toEqual([]);
  });
});

describe("tarjetaYaEnviada", () => {
  it("reconoce la tarjeta por su primer renglón en la bandeja", () => {
    const textos = ["Vivienda 2\nUS$ 120.000\n3 dorm.\n[Quiero visitar]"];
    expect(tarjetaYaEnviada(textos, "Vivienda 2")).toBe(true);
    expect(tarjetaYaEnviada(textos, "Vivienda 5")).toBe(false);
  });
});

describe("normalizar", () => {
  it("quita tildes y signos", () => {
    expect(normalizar("¡Árbol, *Vivienda-2*!")).toBe("arbol vivienda 2");
  });
});

import { describe, expect, it } from "vitest";
import { BOTONES, codigoDeTexto, intencionGerente, lineaPlantilla, textoBienvenida, textoCasas, textoLlamar } from "@/lib/gerente";
import type { DatosVentas } from "@/lib/hermes-ventas";

function base(over: Partial<DatosVentas> = {}): DatosVentas {
  return {
    negocio: "SAMER",
    zona: "America/La_Paz",
    desde: "2026-10-20",
    hasta: "2026-10-26",
    dias: 7,
    agenteEncendido: true,
    periodo: { conversaciones: 3, leadsNuevos: 2, respondioAgente: 10, respondieronPersonas: 1 },
    anterior: { conversaciones: 1, leadsNuevos: 1 },
    ventas: { cerradas: 0, cents: 0, moneda: "USD" },
    embudo: [],
    casas: [],
    visitas: { proximas: [], realizadas: 0, noShow: 0, sinResultado: [], interesados: 0, quierenNegociar: 0, listos: [] },
    teEsperan: { total: 0, ventanaCerrada: 0, principales: [] },
    noSupoResponder: [],
    pidieronPersona: 0,
    laboratorio: null,
    fallosMarcados: 0,
    ...over,
  };
}

describe("codigoDeTexto", () => {
  it("acepta el código como lo escribiría una persona", () => {
    for (const t of ["REI 482913", "rei-482913", " 482913 ", "Rei482913"]) expect(codigoDeTexto(t)).toBe("482913");
  });
  it("no confunde una frase con números con un código", () => {
    for (const t of ["tengo 482913", "48291", "REI 4829130", "¿cómo vamos?"]) expect(codigoDeTexto(t)).toBeNull();
  });
});

describe("intencionGerente", () => {
  const casos: [string, string][] = [
    ["¿Cómo vamos esta semana?", "reporte"],
    ["como van las ventas", "reporte"],
    ["A quién llamo hoy?", "llamar"],
    ["¿Qué mejoro en el WhatsApp?", "mejorar"],
    ["¿Qué casa no se mueve?", "casas"],
    ["qué visitas hay mañana", "visitas"],
    ["pausar reporte", "pausar"],
    ["no me mandes el reporte del lunes", "pausar"],
    ["activar reporte", "reanudar"],
    ["Hola", "ayuda"],
    ["", "ayuda"],
    ["¿Cuál es el cliente que más preguntó por financiamiento?", "pregunta"],
  ];
  it.each(casos)("«%s» → %s", (texto, esperado) => {
    expect(intencionGerente(texto)).toBe(esperado);
  });
  it("los botones se entienden como su pregunta", () => {
    for (const b of BOTONES) expect(intencionGerente(b.title)).toBe(b.id.slice(2));
  });
  it("los botones caben en WhatsApp (3, hasta 20 caracteres)", () => {
    expect(BOTONES.length).toBeLessThanOrEqual(3);
    for (const b of BOTONES) expect(b.title.length).toBeLessThanOrEqual(20);
  });
});

describe("textos", () => {
  it("saluda por el primer nombre y nombra el negocio", () => {
    expect(textoBienvenida("Sergio Aguilar", "SAMER")).toMatch(/^Listo, Sergio\. Soy tu gerente de ventas de \*SAMER\*/);
  });

  it("a quién llamar: primero los que salieron con interés de la visita", () => {
    const t = textoLlamar(
      base({
        visitas: { ...base().visitas, listos: [{ cuando: "2026-10-24 10:00", contacto: "Ana", casa: "V2" }] },
        teEsperan: { total: 1, ventanaCerrada: 0, principales: [{ nombre: "Caro", razon: "Pidió precio", ventana: "Cierra en 3 h" }] },
      }),
    );
    expect(t.indexOf("Ana")).toBeLessThan(t.indexOf("Caro"));
    expect(t).toContain("Te esperan (1)");
  });

  it("sin nadie esperando lo dice, no inventa", () => {
    expect(textoLlamar(base())).toContain("nadie te espera");
  });

  it("casas: las vendidas al final, la que más se mueve primero", () => {
    const t = textoCasas(
      base({
        casas: [
          { titulo: "Casa V1", estado: "cerrada", consultas: 9, visitas: 2 },
          { titulo: "Casa V2", estado: "disponible", consultas: 0, visitas: 0 },
          { titulo: "Casa V3", estado: "disponible", consultas: 4, visitas: 1 },
        ] as DatosVentas["casas"],
      }),
    );
    const orden = ["Casa V3", "Casa V2", "Casa V1"].map((c) => t.indexOf(c));
    expect(orden).toEqual([...orden].sort((a, b) => a - b));
    expect(t).toContain("⚪ Casa V2 · sin consultas");
    expect(t).toContain("⚫ Casa V1 · vendida");
  });

  it("la línea de la plantilla es corta y sin saltos (Meta no los admite en variables)", () => {
    const l = lineaPlantilla(base());
    expect(l).toBe("3 clientes escribieron");
    expect(l).not.toMatch(/\n/);
  });
});

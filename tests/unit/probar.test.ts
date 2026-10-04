import { describe, expect, it } from "vitest";
import { casesToFix, fixFor, passes, probarKind, type CaseLite } from "@/lib/probar";

const kase = (id: string, veredicto: CaseLite["veredicto"], hallazgos: CaseLite["hallazgos"] = []): CaseLite => ({
  id,
  personaLabel: `Caso ${id}`,
  status: "done",
  veredicto,
  hallazgos,
});

describe("probar: pasa o no pasa", () => {
  it("80 o más y ningún caso rojo", () => {
    expect(passes(80, 0)).toBe(true);
    expect(passes(79, 0)).toBe(false);
    expect(passes(95, 1)).toBe(false);
    expect(passes(null, 0)).toBe(false);
  });
});

describe("probarKind", () => {
  const done = { status: "done" as const, score: 90 };
  it("sin corridas", () => expect(probarKind({ latest: null, cases: [], current: null })).toBe("sin_prueba"));
  it("corriendo", () => expect(probarKind({ latest: { status: "running", score: null }, cases: [], current: true })).toBe("en_curso"));
  it("una corrida que falló o sin puntaje no termina", () => {
    expect(probarKind({ latest: { status: "failed", score: null }, cases: [], current: true })).toBe("no_termino");
    expect(probarKind({ latest: { status: "done", score: null }, cases: [], current: true })).toBe("no_termino");
  });
  it("pasa y sigue vigente", () => expect(probarKind({ latest: done, cases: [kase("a", "verde")], current: true })).toBe("paso"));
  it("pasa pero la información cambió después: vieja", () =>
    expect(probarKind({ latest: done, cases: [kase("a", "verde")], current: false })).toBe("vieja"));
  it("mientras no se sabe si es vigente, no se dice que esté vieja", () =>
    expect(probarKind({ latest: done, cases: [kase("a", "verde")], current: null })).toBe("paso"));
  it("un caso rojo no pasa aunque el puntaje sea alto", () =>
    expect(probarKind({ latest: done, cases: [kase("a", "rojo")], current: true })).toBe("no_paso"));
  it("un puntaje bajo no pasa", () =>
    expect(probarKind({ latest: { status: "done", score: 62 }, cases: [], current: true })).toBe("no_paso"));
});

describe("qué corregir, en palabras llanas", () => {
  it("cada tipo de hallazgo dice qué pasó y a dónde ir, sin jerga", () => {
    for (const tipo of ["alucinacion", "fuera_de_kb", "debio_escalar", "tono"] as const) {
      const fix = fixFor({ tipo, evidencia: "x" });
      expect(`${fix.what} ${fix.to.label}`).not.toMatch(/kb|knowledge|alucin|prompt|score/i);
      expect(fix.to.href).toMatch(/^\/agent#/);
    }
  });

  it("lista primero los casos graves y deja fuera los verdes", () => {
    const list = casesToFix([
      kase("verde", "verde"),
      kase("amarillo", "amarillo", [{ tipo: "tono", evidencia: "seco" }]),
      kase("rojo", "rojo", [{ tipo: "alucinacion", evidencia: "inventó un precio" }]),
    ]);
    expect(list.map((c) => c.id)).toEqual(["rojo", "amarillo"]);
    expect(list[0]!.red).toBe(true);
    expect(list[0]!.hallazgos[0]!.fix.what).toBe("Dijo algo que no está en tu información.");
  });

  it("conserva la respuesta que propone el juez para agregarla desde aquí", () => {
    const fix = fixFor({
      tipo: "fuera_de_kb",
      evidencia: "preguntó por envíos",
      sugerencia: { pregunta: "¿Hacen envíos?", respuesta: "Sí, en el este." },
    });
    expect(fix.suggestion).toEqual({ pregunta: "¿Hacen envíos?", respuesta: "Sí, en el este." });
  });
});

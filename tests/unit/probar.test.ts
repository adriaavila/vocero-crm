import { describe, expect, it } from "vitest";
import { casesToFix, consejoDeResultado, fixFor, looksGood, probarKind, type CaseLite } from "@/lib/probar";

const kase = (id: string, veredicto: CaseLite["veredicto"], hallazgos: CaseLite["hallazgos"] = []): CaseLite => ({
  id,
  personaLabel: `Caso ${id}`,
  status: "done",
  veredicto,
  hallazgos,
});

describe("probar: pasa o no pasa", () => {
  it("80 o más y ningún caso rojo", () => {
    expect(looksGood(80, 0)).toBe(true);
    expect(looksGood(79, 0)).toBe(false);
    expect(looksGood(95, 1)).toBe(false);
    expect(looksGood(null, 0)).toBe(false);
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
  it("un caso rojo pide revisar aunque el puntaje sea alto", () =>
    expect(probarKind({ latest: done, cases: [kase("a", "rojo")], current: true })).toBe("revisar"));
  it("un puntaje bajo pide revisar", () =>
    expect(probarKind({ latest: { status: "done", score: 62 }, cases: [], current: true })).toBe("revisar"));
  it("una prueba floja pero anterior al último cambio es vieja", () =>
    expect(probarKind({ latest: { status: "done", score: 62 }, cases: [], current: false })).toBe("vieja"));
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

describe("consejoDeResultado", () => {
  it("dice el puntaje y los casos, y que activar es decisión del dueño", () => {
    expect(consejoDeResultado(67, 2)).toBe(
      "Sacó 67/100 con 2 casos graves. Puedes activarlo igual: tú decides cuándo te gusta cómo responde.",
    );
    expect(consejoDeResultado(50, 1)).toMatch(/con 1 caso grave\./);
    expect(consejoDeResultado(70, 0)).toMatch(/^Sacó 70\/100\. Puedes activarlo igual/);
    expect(consejoDeResultado(90, 1)).toMatch(/^Sacó 90\/100 con 1 caso/);
  });
  it("no aconseja cuando se ve bien ni sin resultado", () => {
    expect(consejoDeResultado(85, 0)).toBeNull();
    expect(consejoDeResultado(null, 0)).toBeNull();
  });
  it("sin em dashes", () => expect(consejoDeResultado(40, 3)).not.toMatch(/—/));
});

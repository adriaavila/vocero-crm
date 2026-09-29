import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { stateLabelFor } from "@/lib/estado";

/**
 * Pantallas que SÍ renderizan para un negocio Rei (a diferencia de
 * `components/agencia/allok/{mark,auth-frame,nav-head}.tsx`, que solo
 * existen bajo `brand().id === "allok"` — ver design/rei.md): el centro de
 * control, la línea del día y la puesta en marcha se comparten entre las dos
 * marcas. Ninguna puede decir "allok" o "all ok" a mano.
 */
const SRC = join(process.cwd(), "src");
const SHARED_REI_SCREENS = [
  join(SRC, "components", "agencia", "allok", "control-center.tsx"),
  join(SRC, "components", "agencia", "allok", "day-line.tsx"),
  join(SRC, "server", "readiness.ts"),
];

describe("Rei no hereda copy de allok en las pantallas que comparte", () => {
  it("ningún literal \"allok\" o \"all ok\" en control-center/day-line/readiness", () => {
    for (const file of SHARED_REI_SCREENS) {
      const source = readFileSync(file, "utf8")
        // Comentarios (de dónde viene el componente, notas técnicas): no son
        // texto que vea un negocio Rei.
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "")
        // El id/valor de tipo `"allok"` (default de prop, unión de tipos) es
        // el nombre de la marca como DATO, no una mención escrita a mano.
        .replace(/"allok"/g, "");
      const matches = source.match(/\ballok\b|all ok/g) ?? [];
      expect({ file, matches }).toEqual({ file, matches: [] });
    }
  });

  it("stateLabelFor: el juego de palabras 'all ok' es solo de allok", () => {
    expect(stateLabelFor("activo", "allok")).toBe("all ok");
    expect(stateLabelFor("activo", "rei")).not.toMatch(/all ok/i);
    expect(stateLabelFor("activo", "rei")).toBe("Todo en orden");
    // Los demás estados no llevan el juego de palabras: se comparten tal cual.
    for (const state of ["atendiendo", "atencion", "pausado"] as const) {
      expect(stateLabelFor(state, "rei")).toBe(stateLabelFor(state, "allok"));
    }
  });
});

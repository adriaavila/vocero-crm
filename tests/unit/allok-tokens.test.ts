import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { STATE_DOT } from "@/lib/estado";

// src/app/allok-tokens.css es el mismo archivo en vocero-crm y en creativ3
// (allok.fun). Si esta huella cambia, el archivo se editó: cópialo entero al
// otro repo y pon la huella nueva en las dos pruebas (aquí y en
// creativ3/src/lib/allok-tokens.test.ts).
const HUELLA = "2d440e94cd2cbde173f445a53cad4c17687ffb155b5258e4da815e3415c2d8e5";

const css = readFileSync(join(process.cwd(), "src/app/allok-tokens.css"), "utf8");
const globals = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

function token(name: string): string {
  const m = css.match(new RegExp(`--${name}:\\s*([^;]+);`));
  if (!m?.[1]) throw new Error(`falta --${name} en allok-tokens.css`);
  return m[1].trim().toLowerCase();
}

describe("allok-tokens.css (compartido con allok.fun)", () => {
  it("es el mismo archivo que en creativ3", () => {
    const huella = createHash("sha256").update(css).digest("hex");
    expect(huella, "allok-tokens.css cambió: cópialo a creativ3 y actualiza la huella en las dos pruebas").toBe(HUELLA);
  });

  it("los puntos de estado son los de estado.ts", () => {
    expect(token("allok-ok")).toBe(STATE_DOT.activo.toLowerCase());
    expect(token("allok-atendiendo")).toBe(STATE_DOT.atendiendo.toLowerCase());
    expect(token("allok-atencion")).toBe(STATE_DOT.atencion.toLowerCase());
    expect(token("allok-pausado")).toBe(STATE_DOT.pausado.toLowerCase());
  });

  it("el bloque de allok lee la marca de ahí y no escribe sus estados a mano", () => {
    const inicio = globals.indexOf(':root[data-saas="true"] {');
    const fin = globals.indexOf(':root[data-brand="rei"] {');
    const saas = globals.slice(inicio, fin);
    expect(inicio).toBeGreaterThan(-1);
    for (const hex of ["#20e58d", "#5b8cff", "#ffb020", "#0a7a48", "#2348cc", "#7a5600"]) {
      expect(saas.toLowerCase(), `${hex} escrito a mano en [data-saas]`).not.toContain(`: ${hex};`);
    }
  });
});

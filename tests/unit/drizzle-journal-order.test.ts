import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * El orden en que se aplican las migraciones es el orden del ARRAY en
 * `_journal.json`, no el de `when`. Pero varias ramas apiladas tocan este
 * archivo a mano —un `idx` que salta a propósito para dejarle hueco a un PR
 * paralelo, un `when` que tiene que ganarle al de la migración anterior para
 * que quede claro quién es más nueva— y un desliz ahí no lo cacha ni
 * typecheck ni build: solo se ve corriendo las migraciones contra una base
 * real, y para entonces ya se aplicó en el orden equivocado.
 *
 * Esta prueba es el guardrail: si `idx` o `when` dejan de crecer
 * estrictamente de una entrada a la siguiente, se rompe aquí, antes de
 * mergear. (018 — spec 018-anuncio-de-origen: primera migración de upstream
 * insertada a mano en este fork, idx 20 después de nuestro idx 19.)
 */

const RAIZ = path.resolve(import.meta.dirname, "..", "..");
const journal = JSON.parse(
  readFileSync(path.join(RAIZ, "drizzle", "meta", "_journal.json"), "utf8")
) as { entries: Array<{ idx: number; when: number; tag: string }> };

describe("drizzle/meta/_journal.json — orden de las migraciones", () => {
  it("no está vacío", () => {
    expect(journal.entries.length).toBeGreaterThan(0);
  });

  it("idx crece estrictamente de una entrada a la siguiente (puede saltar números a propósito, para dejarle hueco a un PR paralelo, pero nunca retrocede ni repite)", () => {
    for (let i = 1; i < journal.entries.length; i++) {
      const prev = journal.entries[i - 1]!;
      const cur = journal.entries[i]!;
      expect(
        cur.idx,
        `idx de "${cur.tag}" (${cur.idx}) debe ser mayor que el de "${prev.tag}" (${prev.idx})`
      ).toBeGreaterThan(prev.idx);
    }
  });

  it("when crece estrictamente con idx", () => {
    for (let i = 1; i < journal.entries.length; i++) {
      const prev = journal.entries[i - 1]!;
      const cur = journal.entries[i]!;
      expect(
        cur.when,
        `when de "${cur.tag}" (${cur.when}) debe ser mayor que el de "${prev.tag}" (${prev.when}); si una migración de upstream se inserta a mano, se mantiene su "when" pero debe seguir siendo mayor que el de la entrada anterior en ESTA rama`
      ).toBeGreaterThan(prev.when);
    }
  });

  it("idx no se repite", () => {
    const vistos = new Set<number>();
    for (const e of journal.entries) {
      expect(vistos.has(e.idx), `idx ${e.idx} repetido (tag "${e.tag}")`).toBe(
        false
      );
      vistos.add(e.idx);
    }
  });
});

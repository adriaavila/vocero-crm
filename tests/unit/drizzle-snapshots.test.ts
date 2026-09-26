import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `drizzle-kit generate` no lee `_journal.json` para decidir contra qué
 * diffear: ordena como TEXTO los archivos de `drizzle/meta/` y toma el último
 * (drizzle-kit 0.31: `prepareOutFolder` + `preparePrevSnapshot`). Con dos
 * rangos de números (00xx de upstream, 9xxx del fork), un snapshot del fork
 * que se quede con nombre 00xx deja de ser el último aunque sea el más nuevo,
 * y el siguiente `db:generate` diffea contra uno viejo: vuelve a emitir DDL ya
 * aplicado y el contenedor no arranca ("relation already exists").
 *
 * `pnpm db:generate` corre esta prueba antes de generar nada.
 */

const META = path.resolve(import.meta.dirname, "..", "..", "drizzle", "meta");

// El mismo filtro y el mismo orden que usa drizzle-kit.
const archivos = readdirSync(META)
  .filter((f) => !f.startsWith("_"))
  .sort();
const snapshots = archivos.map((archivo) => {
  const s = JSON.parse(readFileSync(path.join(META, archivo), "utf8")) as {
    id: string;
    prevId: string;
  };
  return { archivo, id: s.id, prevId: s.prevId };
});
const padres = new Set(snapshots.map((s) => s.prevId));
const puntas = snapshots.filter((s) => !padres.has(s.id));
const journal = JSON.parse(
  readFileSync(path.join(META, "_journal.json"), "utf8")
) as { entries: Array<{ idx: number; when: number; tag: string }> };

describe("drizzle/meta: el snapshot contra el que diffea db:generate", () => {
  it("dos snapshots nunca cuelgan del mismo padre", () => {
    const hijos = new Map<string, string[]>();
    for (const s of snapshots) {
      hijos.set(s.prevId, [...(hijos.get(s.prevId) ?? []), s.archivo]);
    }
    for (const [prevId, mismos] of hijos) {
      expect(
        mismos,
        `${mismos.join(" y ")} cuelgan del mismo padre (${prevId}): un snapshot de upstream se borra; entre dos del fork, el nuevo se generó contra una punta equivocada (ver "Migraciones y snapshots" en CLAUDE.md)`
      ).toHaveLength(1);
    }
  });

  it("hay una sola punta y es el último archivo por orden de texto", () => {
    const ultimo = archivos.at(-1);
    expect(
      puntas.map((s) => s.archivo),
      `db:generate diffea contra ${ultimo}: la punta de la cadena id → prevId tiene que ser ese archivo. Si la punta es una migración del fork, muévela entera (.sql, snapshot, tag e idx del journal) al siguiente 9xxx libre, o bórrala y vuelve a generarla (ver "Migraciones y snapshots" en CLAUDE.md)`
    ).toEqual([ultimo]);
  });

  it("el idx de la última entrada del journal no queda por debajo de la punta", () => {
    // drizzle-kit numera el archivo nuevo con idx + 1 de la última entrada:
    // así nace 9xxx, ordena después de la punta y no pisa un snapshot.
    const ultima = journal.entries.at(-1);
    const punta = Number.parseInt(puntas[0]?.archivo ?? "", 10);
    expect(
      ultima?.idx,
      `el siguiente db:generate se llamaría ${String((ultima?.idx ?? 0) + 1).padStart(4, "0")}_…: sube el idx de "${ultima?.tag}" a ${punta} o más`
    ).toBeGreaterThanOrEqual(punta);
  });

  it("el when crece de una entrada a la siguiente", () => {
    // El migrador solo aplica lo que supera al último `when` aplicado: una
    // entrada con `when` menor se salta EN SILENCIO en las bases que existen.
    journal.entries.forEach((e, i) => {
      const antes = journal.entries[i - 1];
      if (!antes) return;
      expect(
        e.when,
        `"${e.tag}" tiene un when (${e.when}) que no supera al de "${antes.tag}" (${antes.when}): en las bases que ya existen no se aplicaría nunca`
      ).toBeGreaterThan(antes.when);
    });
  });
});

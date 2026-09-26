import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `drizzle/meta/_journal.json` es lo que el migrador (y `drizzle-kit`) recorre
 * EN ORDEN DE ARREGLO para decidir qué aplicar y en qué secuencia — nunca por
 * el valor de `idx`. Por eso lo único que de verdad importa es que `when`
 * (el timestamp que ordena) crezca estrictamente entrada tras entrada: un
 * `when` fuera de orden puede hacer que una migración se aplique antes que
 * otra de la que depende, o que `drizzle-kit` calcule mal cuál es "la última".
 *
 * `idx` en cambio SÍ puede tener huecos a propósito: 0021_nea_sin_estado se
 * agregó con `idx: 21` mientras el PR paralelo que reserva `idx: 20`
 * (`0014_anuncio_de_origen`) no había llegado a `origin/main` — Adrian
 * reconcilia el hueco al fusionar. Este test no exige `idx` consecutivo.
 */

const JOURNAL_PATH = path.resolve(
  import.meta.dirname,
  "..",
  "..",
  "drizzle",
  "meta",
  "_journal.json"
);

type JournalEntry = { idx: number; when: number; tag: string };

function readJournal(): JournalEntry[] {
  const raw = readFileSync(JOURNAL_PATH, "utf8");
  return (JSON.parse(raw) as { entries: JournalEntry[] }).entries;
}

describe("drizzle/meta/_journal.json", () => {
  it("`when` crece estrictamente entrada tras entrada, en el orden del arreglo", () => {
    const entries = readJournal();
    expect(entries.length).toBeGreaterThan(0);

    for (let i = 1; i < entries.length; i++) {
      const prev = entries[i - 1]!;
      const curr = entries[i]!;
      expect(
        curr.when,
        `entries[${i}] (tag "${curr.tag}", when=${curr.when}) debe ser > entries[${i - 1}] (tag "${prev.tag}", when=${prev.when})`
      ).toBeGreaterThan(prev.when);
    }
  });

  it("0021_nea_sin_estado existe, viene después de 0019 y su `when` > el reservado para idx 20 (0014_anuncio_de_origen, 1790048470717)", () => {
    const entries = readJournal();
    const idx19 = entries.findIndex((e) => e.tag === "0019_rei_saas_ai_credentials");
    const propio = entries.findIndex((e) => e.tag === "0021_nea_sin_estado");

    expect(idx19).toBeGreaterThanOrEqual(0);
    expect(propio).toBeGreaterThan(idx19);
    expect(entries[propio]!.idx).toBe(21);
    // El PR paralelo (3a) reserva idx 20 con when=1790048470717; el nuestro
    // tiene que quedar después de ese instante aunque su entrada todavía no
    // esté en el journal.
    expect(entries[propio]!.when).toBeGreaterThan(1790048470717);
  });

  it("cada tag del journal tiene su archivo .sql correspondiente", () => {
    const entries = readJournal();
    const drizzleDir = path.resolve(JOURNAL_PATH, "..", "..");
    for (const entry of entries) {
      expect(() =>
        readFileSync(path.join(drizzleDir, `${entry.tag}.sql`), "utf8")
      ).not.toThrow();
    }
  });
});

import { describe, expect, it } from "vitest";
import {
  TIMEZONE_OPTIONS,
  getTimezoneOptions,
} from "@/components/ui/timezone-select";

/**
 * El selector de zona horaria reemplaza un input de texto libre, pero sigue
 * guardando el mismo string IANA que valida `isValidTimeZone`
 * (src/lib/time/slots.ts). Dos cosas no pueden romperse:
 * - Todas las zonas listadas son válidas para el runtime (si no, el server
 *   las rechazaría al guardar).
 * - Un valor guardado que no esté en la lista curada (por ejemplo, un string
 *   escrito a mano antes de este selector) sigue apareciendo como opción en
 *   vez de cambiarse en silencio.
 */

describe("TIMEZONE_OPTIONS", () => {
  it("son todas zonas IANA válidas según Intl", () => {
    for (const tz of TIMEZONE_OPTIONS) {
      expect(() => new Intl.DateTimeFormat("en-US", { timeZone: tz.value })).not.toThrow();
    }
  });

  it("no tiene valores repetidos", () => {
    const values = TIMEZONE_OPTIONS.map((tz) => tz.value);
    expect(new Set(values).size).toBe(values.length);
  });
});

describe("getTimezoneOptions", () => {
  it("agrega un valor guardado que no está en la lista curada, sin cambiarlo", () => {
    const options = getTimezoneOptions("Asia/Tokyo");
    expect(options.some((tz) => tz.value === "Asia/Tokyo")).toBe(true);
    expect(options.length).toBe(TIMEZONE_OPTIONS.length + 1);
  });

  it("no duplica un valor que ya está en la lista curada", () => {
    const options = getTimezoneOptions("America/Bogota");
    expect(options.filter((tz) => tz.value === "America/Bogota").length).toBe(1);
    expect(options.length).toBe(TIMEZONE_OPTIONS.length);
  });

  it("sin valor guardado, devuelve la lista curada tal cual", () => {
    expect(getTimezoneOptions(undefined)).toEqual(TIMEZONE_OPTIONS);
    expect(getTimezoneOptions("")).toEqual(TIMEZONE_OPTIONS);
  });
});

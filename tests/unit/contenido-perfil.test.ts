import { describe, expect, it } from "vitest";
import { profileContentChanged } from "@/server/agencia/contenido-perfil";

const stored = {
  name: "Asistente",
  tone: "Cercano",
  instructions: "Vendemos pan.",
  escalationRules: null,
  greeting: "Hola",
};

describe("profileContentChanged", () => {
  it("pausar, encender y los controles de operación no cambian el contenido", () => {
    expect(profileContentChanged(stored, {})).toBe(false);
  });

  it("el mismo texto reenviado no cambia el contenido", () => {
    expect(profileContentChanged(stored, { ...stored })).toBe(false);
  });

  it("vacío, null y espacios cuentan igual", () => {
    expect(profileContentChanged(stored, { escalationRules: "" })).toBe(false);
    expect(profileContentChanged(stored, { escalationRules: "   " })).toBe(false);
    expect(profileContentChanged(stored, { instructions: "  Vendemos pan.  " })).toBe(false);
  });

  it.each(["name", "tone", "instructions", "escalationRules", "greeting"] as const)(
    "cambiar %s mueve el contenido",
    (field) => {
      expect(profileContentChanged(stored, { [field]: "Algo distinto" })).toBe(true);
    },
  );

  it("borrar un campo con texto es un cambio", () => {
    expect(profileContentChanged(stored, { instructions: null })).toBe(true);
  });
});

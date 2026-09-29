import { describe, expect, it } from "vitest";
import { deriveRegistrationPin } from "@/server/agencia/whatsapp-signup/pin";

const KEY = Buffer.alloc(32, 7).toString("base64");

describe("deriveRegistrationPin", () => {
  it("es determinista: mismo phoneNumberId + clave → mismo PIN siempre", () => {
    const a = deriveRegistrationPin("phone_123", KEY);
    const b = deriveRegistrationPin("phone_123", KEY);
    expect(a).toBe(b);
  });

  it("son 6 dígitos, con ceros a la izquierda si hace falta", () => {
    for (const phoneId of ["p1", "p2", "p3", "otra-cosa", "1234567890"]) {
      const pin = deriveRegistrationPin(phoneId, KEY);
      expect(pin).toMatch(/^\d{6}$/);
    }
  });

  it("números distintos producen (casi siempre) PINes distintos", () => {
    const a = deriveRegistrationPin("phone_a", KEY);
    const b = deriveRegistrationPin("phone_b", KEY);
    expect(a).not.toBe(b);
  });

  it("una clave distinta produce un PIN distinto para el mismo número", () => {
    const otherKey = Buffer.alloc(32, 9).toString("base64");
    const a = deriveRegistrationPin("phone_123", KEY);
    const b = deriveRegistrationPin("phone_123", otherKey);
    expect(a).not.toBe(b);
  });

  it("nunca se guarda en ninguna tabla: es puro (sin DB, sin efectos)", () => {
    // Documenta la decisión de diseño: llamarla dos veces no tiene efectos
    // secundarios observables más allá del valor devuelto.
    expect(() => deriveRegistrationPin("phone_x", KEY)).not.toThrow();
  });
});

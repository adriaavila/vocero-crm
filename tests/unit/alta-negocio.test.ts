import { afterEach, describe, expect, it, vi } from "vitest";
import { mensajeParaElDueno, normalizarDireccion, validarDireccion } from "@/server/agencia/alta-negocio";

describe("Alta admin: la dirección del negocio", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("acepta una dirección corta como santorini", () => {
    expect(validarDireccion("santorini")).toEqual({ ok: true });
  });

  it("normaliza lo que escribe el admin", () => {
    expect(normalizarDireccion("  Santorini ")).toBe("santorini");
  });

  it("rechaza espacios, acentos y guiones en los bordes", () => {
    expect(validarDireccion("casa bonita").ok).toBe(false);
    expect(validarDireccion("añil").ok).toBe(false);
    expect(validarDireccion("-santorini").ok).toBe(false);
  });

  it("rechaza las reservadas, también las que suma el despliegue", () => {
    expect(validarDireccion("admin").ok).toBe(false);
    vi.stubEnv("ALLOK_RESERVED_SUBDOMAINS", "inmo,portal");
    expect(validarDireccion("portal").ok).toBe(false);
  });
});

describe("Alta admin: el mensaje para el dueño", () => {
  it("lleva la dirección y el correo, nunca la contraseña", () => {
    const mensaje = mensajeParaElDueno({
      nombre: "Condominio Santorini",
      url: "https://santorini.reiprop.tech",
      email: "sergio@samer.bo",
    });
    expect(mensaje).toContain("santorini.reiprop.tech/login");
    expect(mensaje).toContain("sergio@samer.bo");
    expect(mensaje).not.toContain("https://");
    expect(mensaje.toLowerCase()).toContain("la contraseña te la paso aparte");
  });
});

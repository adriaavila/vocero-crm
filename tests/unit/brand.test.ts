import { afterEach, describe, expect, it, vi } from "vitest";
import { activeBrandId, brand, brandById } from "@/lib/brand";

describe("selección de marca (BRAND)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("sin BRAND, vacío o cualquier otra cosa: allok, el default de hoy", () => {
    vi.stubEnv("BRAND", "");
    expect(activeBrandId()).toBe("allok");
    vi.stubEnv("BRAND", "acme");
    expect(activeBrandId()).toBe("allok");
  });

  it("BRAND=rei (insensible a mayúsculas y espacios) activa Rei", () => {
    vi.stubEnv("BRAND", "rei");
    expect(activeBrandId()).toBe("rei");
    vi.stubEnv("BRAND", "  REI  ");
    expect(activeBrandId()).toBe("rei");
  });

  it("brand() sigue a BRAND en cada llamada, no lo congela", () => {
    vi.stubEnv("BRAND", "rei");
    expect(brand().id).toBe("rei");
    vi.stubEnv("BRAND", "");
    expect(brand().id).toBe("allok");
  });
});

/**
 * Fija los valores EXACTOS de la marca allok: para BRAND=allok (el default),
 * nada de lo que ve un usuario puede cambiar. Si un valor de acá se mueve,
 * algo en el repo lo hizo también — y ese diff es el que hay que revisar.
 */
describe("allok: valores fijos (byte a byte)", () => {
  it("identidad", () => {
    expect(brandById("allok")).toEqual({
      id: "allok",
      name: "allok",
      Name: "Allok",
      productName: "allok",
      defaultAccent: "#0b0d0e",
      signupHostHint: "El registro de Allok empieza en",
      contact: { whatsapp: "584220023684", email: null },
      pricingHref: "https://allok.fun/#precios",
      startMessage: "Hola, vengo de allok.fun. Quiero un agente de WhatsApp para mi negocio.",
      helpMessage: "Hola, necesito recuperar el acceso a mi cuenta de allok.",
    });
  });
});

describe("Rei: identidad propia", () => {
  it("nombre, acento y precios son los de Rei, no los de allok", () => {
    const rei = brandById("rei");
    expect(rei.name).toBe("Rei");
    expect(rei.productName).toBe("Rei");
    expect(rei.defaultAccent).toBe("#0a7350");
    expect(rei.pricingHref).toBe("/precios");
    expect(rei.contact.whatsapp).not.toBe("584220023684");
  });

  it("el contacto de Rei sale de CONTACT_WHATSAPP/CONTACT_EMAIL, no trae uno de fábrica", () => {
    // brandById lee el entorno en cada llamada, como brand().
    const previoW = process.env.CONTACT_WHATSAPP;
    const previoE = process.env.CONTACT_EMAIL;
    try {
      delete process.env.CONTACT_WHATSAPP;
      delete process.env.CONTACT_EMAIL;
      expect(brandById("rei").contact).toEqual({ whatsapp: null, email: null });
      process.env.CONTACT_WHATSAPP = "  59171234567  ";
      expect(brandById("rei").contact.whatsapp).toBe("59171234567");
    } finally {
      if (previoW === undefined) delete process.env.CONTACT_WHATSAPP;
      else process.env.CONTACT_WHATSAPP = previoW;
      if (previoE === undefined) delete process.env.CONTACT_EMAIL;
      else process.env.CONTACT_EMAIL = previoE;
    }
  });
});

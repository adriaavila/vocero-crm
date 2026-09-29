import { describe, expect, it } from "vitest";
import {
  MAX_PHOTOS_PER_PROPERTY,
  MAX_PHOTO_BYTES,
  isAllowedMimeType,
  validatePhoto,
} from "@/server/realty/photos";
import {
  DEFAULT_CURRENCY,
  derivedTitle,
  formatPrice,
  formatZone,
} from "@/lib/realty/catalog";

/**
 * Portado del fork inmobiliario (`vocero-inmobiliario-main`,
 * `tests/unit/realty-guards.test.ts`) — solo la parte de topes de fotos y
 * formateo del catálogo; los candados del agente (`isAllowedProperty`,
 * `resolveOfferedSlot`, `degradeAction`) son de Nea (parte 2, `/api/bot/
 * realty/*`) y no existen todavía en este repo.
 */

describe("topes de fotos (el binario vive en el conector de almacenamiento, nunca en Postgres)", () => {
  it("acepta una foto JPEG normal", () => {
    expect(
      validatePhoto({
        mimeType: "image/jpeg",
        byteSize: 300 * 1024,
        currentCount: 0,
      })
    ).toBeNull();
  });

  it("acepta PNG y WebP — el catálogo de mime del vertical los admite", () => {
    expect(isAllowedMimeType("image/png")).toBe(true);
    expect(isAllowedMimeType("image/webp")).toBe(true);
    expect(isAllowedMimeType("image/gif")).toBe(false);
  });

  it("rechaza un tipo no soportado", () => {
    const error = validatePhoto({
      mimeType: "image/gif",
      byteSize: 1000,
      currentCount: 0,
    });
    expect(error?.code).toBe("bad_type");
  });

  it("rechaza una foto de más de 3 MB", () => {
    const error = validatePhoto({
      mimeType: "image/jpeg",
      byteSize: MAX_PHOTO_BYTES + 1,
      currentCount: 0,
    });
    expect(error?.code).toBe("too_large");
    expect(error?.message).toMatch(/3 MB/);
  });

  it("rechaza pasar de 15 fotos por propiedad", () => {
    expect(
      validatePhoto({
        mimeType: "image/jpeg",
        byteSize: 1000,
        currentCount: MAX_PHOTOS_PER_PROPERTY - 1,
      })
    ).toBeNull();
    expect(
      validatePhoto({
        mimeType: "image/jpeg",
        byteSize: 1000,
        currentCount: MAX_PHOTOS_PER_PROPERTY,
      })?.code
    ).toBe("too_many");
  });

  it("rechaza un archivo vacío", () => {
    expect(
      validatePhoto({ mimeType: "image/jpeg", byteSize: 0, currentCount: 0 })
        ?.code
    ).toBe("invalid");
  });
});

describe("derivados del catálogo", () => {
  it("el título derivado nunca queda vacío", () => {
    expect(derivedTitle("departamento", "Santa Cruz")).toBe(
      "Departamento en Santa Cruz"
    );
    expect(derivedTitle("departamento", null)).toBe("Departamento");
    expect(derivedTitle("departamento", "   ")).toBe("Departamento");
  });

  it("el precio imprime la moneda una sola vez", () => {
    // Separador de miles con punto: es el de Bolivia y el de PRICE_LOCALE.
    expect(formatPrice(185000, "USD")).toBe("$185.000 USD");
    expect(formatPrice(78000, "MXN")).toBe("$78.000 MXN");
    expect(formatPrice(null, "USD")).toBe("—");
  });

  it("los bolivianos se dicen 'Bs', nunca '$... BOB' — así habla el mercado", () => {
    expect(formatPrice("1260000", "BOB")).toBe("Bs 1.260.000");
    expect(formatPrice(3150, "BOB")).toBe("Bs 3.150");
  });

  it("sin moneda válida cae al default del producto, no a un mercado ajeno", () => {
    expect(formatPrice(185000, null)).toBe(`$185.000 ${DEFAULT_CURRENCY}`);
    expect(formatPrice(185000, "EUR")).toBe(`$185.000 ${DEFAULT_CURRENCY}`);
  });

  it("la zona cae a un guion cuando no hay colonia ni ciudad", () => {
    expect(formatZone("Equipetrol", "Santa Cruz")).toBe("Equipetrol, Santa Cruz");
    expect(formatZone(null, "Santa Cruz")).toBe("Santa Cruz");
    expect(formatZone(null, null)).toBe("—");
  });
});

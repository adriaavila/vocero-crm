import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvCacheForTests } from "@/lib/env";
import {
  extensionForMime,
  getLocalObject,
  propertyPhotoKey,
  publicUrl,
  putObject,
  deleteObject,
} from "@/server/storage/r2";
import { getImageDimensions } from "@/server/storage/image-dimensions";

/**
 * Conector de fotos (Constitución II): verifica el layout de llaves, el
 * camino sin dependencia externa (disco local bajo MEDIA_DIR) y que
 * `publicUrl` cambia de forma según haya o no R2 configurado — sin pegarle
 * jamás a la red real de R2 (eso lo cubre `realty-sigv4.test.ts`, que prueba
 * la firma contra el vector oficial de AWS).
 */

// `getEnv()` exige su base completa (igual que en credentials.test.ts): sin
// esto, cualquier prueba que toque `publicUrl`/`putObject` (pasan por
// `getEnv().MEDIA_DIR` o `.R2_PUBLIC_BASE_URL`) truena con "Variables de
// entorno inválidas o faltantes" antes de llegar a lo que se quiere probar.
beforeEach(() => {
  vi.stubEnv("APP_BASE_URL", "http://localhost:3000");
  vi.stubEnv("DATABASE_URL", "postgresql://t:t@localhost:5432/t");
  vi.stubEnv("BETTER_AUTH_SECRET", "secret-de-test-suficiente");
  vi.stubEnv("ENCRYPTION_KEY", Buffer.alloc(32, 9).toString("base64"));
  vi.stubEnv("META_WEBHOOK_VERIFY_TOKEN", "verify-test");
  resetEnvCacheForTests();
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetEnvCacheForTests();
});

describe("propertyPhotoKey / extensionForMime", () => {
  it("arma la llave org/<orgId>/properties/<propertyId>/<photoId>.<ext>", () => {
    expect(propertyPhotoKey("org_1", "prop_1", "pph_1", "image/jpeg")).toBe(
      "org/org_1/properties/prop_1/pph_1.jpg"
    );
    expect(propertyPhotoKey("org_1", "prop_1", "pph_1", "image/png")).toBe(
      "org/org_1/properties/prop_1/pph_1.png"
    );
    expect(propertyPhotoKey("org_1", "prop_1", "pph_1", "image/webp")).toBe(
      "org/org_1/properties/prop_1/pph_1.webp"
    );
  });

  it("una extensión no reconocida cae a .bin, nunca revienta", () => {
    expect(extensionForMime("application/octet-stream")).toBe("bin");
  });
});

describe("publicUrl — cambia de forma según haya R2 o no", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    resetEnvCacheForTests();
  });

  it("sin las 5 variables de R2, apunta a la ruta autenticada local", () => {
    vi.stubEnv("R2_ACCOUNT_ID", "");
    vi.stubEnv("R2_ACCESS_KEY_ID", "");
    vi.stubEnv("R2_SECRET_ACCESS_KEY", "");
    vi.stubEnv("R2_BUCKET", "");
    vi.stubEnv("R2_PUBLIC_BASE_URL", "");
    resetEnvCacheForTests();
    const key = "org/org_1/properties/prop_1/pph_1.jpg";
    expect(publicUrl(key)).toBe(`/api/storage/${key}`);
  });

  it("con R2 configurado, apunta al dominio público del bucket sin barra doble", () => {
    vi.stubEnv("R2_ACCOUNT_ID", "acc123");
    vi.stubEnv("R2_ACCESS_KEY_ID", "key123");
    vi.stubEnv("R2_SECRET_ACCESS_KEY", "secret123");
    vi.stubEnv("R2_BUCKET", "fotos-rei");
    vi.stubEnv("R2_PUBLIC_BASE_URL", "https://fotos.reiprop.tech/");
    resetEnvCacheForTests();
    const key = "org/org_1/properties/prop_1/pph_1.jpg";
    expect(publicUrl(key)).toBe(`https://fotos.reiprop.tech/${key}`);
  });
});

describe("camino sin dependencia externa (disco bajo MEDIA_DIR)", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "vocero-realty-storage-"));
    vi.stubEnv("MEDIA_DIR", dir);
    vi.stubEnv("R2_ACCOUNT_ID", "");
    vi.stubEnv("R2_ACCESS_KEY_ID", "");
    vi.stubEnv("R2_SECRET_ACCESS_KEY", "");
    vi.stubEnv("R2_BUCKET", "");
    vi.stubEnv("R2_PUBLIC_BASE_URL", "");
    resetEnvCacheForTests();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetEnvCacheForTests();
    rmSync(dir, { recursive: true, force: true });
  });

  it("putObject → getLocalObject hace ida y vuelta con los mismos bytes", async () => {
    const key = propertyPhotoKey("org_1", "prop_1", "pph_1", "image/jpeg");
    const bytes = Buffer.from("contenido-de-prueba-de-una-foto");
    await putObject(key, bytes, "image/jpeg");
    const read = await getLocalObject(key);
    expect(read?.equals(bytes)).toBe(true);
  });

  it("deleteObject borra el archivo; una segunda vez no truena (idempotente)", async () => {
    const key = propertyPhotoKey("org_1", "prop_1", "pph_1", "image/png");
    await putObject(key, Buffer.from("x"), "image/png");
    await deleteObject(key);
    expect(await getLocalObject(key)).toBeNull();
    await expect(deleteObject(key)).resolves.toBeUndefined();
  });

  it("una llave que no sigue el layout esperado se rechaza (no se sale de MEDIA_DIR)", async () => {
    await expect(putObject("../../etc/passwd", Buffer.from("x"), "image/png")).rejects.toThrow();
  });

  it("leer una llave inexistente devuelve null, no lanza", async () => {
    expect(await getLocalObject("org/org_1/properties/prop_1/no_existe.jpg")).toBeNull();
  });
});

describe("getImageDimensions", () => {
  it("lee ancho y alto de un PNG por su cabecera IHDR", () => {
    // Firma PNG + longitud de chunk (13) + "IHDR" + ancho(4) + alto(4) BE.
    const buf = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from([0x00, 0x00, 0x00, 0x0d]),
      Buffer.from("IHDR", "ascii"),
      (() => {
        const b = Buffer.alloc(8);
        b.writeUInt32BE(320, 0);
        b.writeUInt32BE(240, 4);
        return b;
      })(),
    ]);
    expect(getImageDimensions(buf, "image/png")).toEqual({ width: 320, height: 240 });
  });

  it("lee ancho y alto de un JPEG por su segmento SOF0", () => {
    // SOI, SOF0 (longitud 11: precisión 1 + alto 2 + ancho 2 + 1 componente×3), EOI.
    const buf = Buffer.from([
      0xff, 0xd8, // SOI
      0xff, 0xc0, // SOF0
      0x00, 0x0b, // longitud = 11
      0x08, // precisión
      0x00, 0x40, // alto = 64
      0x00, 0x20, // ancho = 32
      0x01, // 1 componente
      0x01, 0x11, 0x00,
      0xff, 0xd9, // EOI
    ]);
    expect(getImageDimensions(buf, "image/jpeg")).toEqual({ width: 32, height: 64 });
  });

  it("lee ancho y alto de un WebP extendido (VP8X)", () => {
    const flags = Buffer.alloc(4);
    const widthMinus1 = Buffer.alloc(3);
    widthMinus1.writeUIntLE(99, 0, 3); // ancho = 100
    const heightMinus1 = Buffer.alloc(3);
    heightMinus1.writeUIntLE(49, 0, 3); // alto = 50
    const buf = Buffer.concat([
      Buffer.from("RIFF", "ascii"),
      Buffer.from([0, 0, 0, 0]), // tamaño total, sin usar por el parser
      Buffer.from("WEBP", "ascii"),
      Buffer.from("VP8X", "ascii"),
      Buffer.from([10, 0, 0, 0]), // tamaño del chunk
      flags,
      widthMinus1,
      heightMinus1,
    ]);
    expect(getImageDimensions(buf, "image/webp")).toEqual({ width: 100, height: 50 });
  });

  it("un buffer truncado o de un formato no reconocido devuelve null, nunca lanza", () => {
    expect(getImageDimensions(Buffer.from("no-es-una-imagen"), "image/jpeg")).toBeNull();
    expect(getImageDimensions(Buffer.alloc(0), "image/png")).toBeNull();
    expect(getImageDimensions(Buffer.from("algo"), "application/pdf")).toBeNull();
  });
});

describe("isSafeStorageKey", async () => {
  const { isSafeStorageKey } = await import("@/server/storage/r2");
  it("acepta la llave que arma propertyPhotoKey", () => {
    expect(isSafeStorageKey("org/org_a/properties/prop_1/pph_1.jpg")).toBe(true);
  });
  it("rechaza segmentos . y ..", () => {
    expect(isSafeStorageKey("org/org_a/properties/../pph_1.jpg")).toBe(false);
    expect(isSafeStorageKey("org/org_a/properties/prop_1/..")).toBe(false);
    expect(isSafeStorageKey("org/org_a/properties/./pph_1.jpg")).toBe(false);
  });
});

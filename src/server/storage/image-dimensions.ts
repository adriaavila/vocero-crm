/**
 * Ancho y alto de un JPEG/PNG/WebP leyendo solo su encabezado — sin decodificar
 * el píxel, sin `sharp` ni ningún binario nativo de imagen en el contenedor
 * (mismo criterio que `components/realty/resize-image.ts` reescala en el
 * navegador: el servidor no procesa imágenes). Cada formato guarda sus
 * dimensiones en una posición fija de los primeros bytes; esto solo las lee.
 *
 * Mejor esfuerzo: si el formato no se reconoce o el buffer viene truncado,
 * devuelve `null` en vez de lanzar — una foto sin dimensiones detectadas se
 * guarda igual (`property_photo.width/height` son nullable).
 */

export type ImageDimensions = { width: number; height: number };

function pngDimensions(buf: Buffer): ImageDimensions | null {
  const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (buf.length < 24) return null;
  for (let i = 0; i < SIGNATURE.length; i++) {
    if (buf[i] !== SIGNATURE[i]) return null;
  }
  // Bytes 8-11: longitud del chunk (13 para IHDR); 12-15: el tipo "IHDR".
  if (buf.toString("ascii", 12, 16) !== "IHDR") return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/** Marcadores JPEG "Start Of Frame" (baseline y progresivo); excluye DHT/JPG/DAC. */
function isSofMarker(marker: number): boolean {
  return (
    marker >= 0xc0 &&
    marker <= 0xcf &&
    marker !== 0xc4 &&
    marker !== 0xc8 &&
    marker !== 0xcc
  );
}

function jpegDimensions(buf: Buffer): ImageDimensions | null {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 1 < buf.length) {
    if (buf[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buf[offset + 1]!;
    // SOI/EOI/RST0-7/TEM no llevan campo de longitud.
    if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    if (offset + 4 > buf.length) return null;
    const segmentLength = buf.readUInt16BE(offset + 2);
    if (isSofMarker(marker)) {
      if (offset + 9 > buf.length) return null;
      const height = buf.readUInt16BE(offset + 5);
      const width = buf.readUInt16BE(offset + 7);
      return { width, height };
    }
    if (marker === 0xda || segmentLength < 2) return null; // Start Of Scan: ya no hay más marcadores útiles.
    offset += 2 + segmentLength;
  }
  return null;
}

function readUInt24LE(buf: Buffer, offset: number): number {
  return buf[offset]! | (buf[offset + 1]! << 8) | (buf[offset + 2]! << 16);
}

function webpDimensions(buf: Buffer): ImageDimensions | null {
  if (buf.length < 30) return null;
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WEBP") {
    return null;
  }
  const fourCc = buf.toString("ascii", 12, 16);
  const chunkStart = 20; // 12 (RIFF+tamaño+"WEBP") + 4 (fourCC) + 4 (tamaño del chunk)
  if (fourCc === "VP8X") {
    // 4 bytes de flags, luego ancho-1 y alto-1 en 3 bytes little-endian c/u.
    const width = readUInt24LE(buf, chunkStart + 4) + 1;
    const height = readUInt24LE(buf, chunkStart + 7) + 1;
    return { width, height };
  }
  if (fourCc === "VP8L") {
    // Firma 0x2F, luego 14 bits de ancho-1 y 14 bits de alto-1 en un uint32 LE.
    if (buf[chunkStart] !== 0x2f) return null;
    const bits = buf.readUInt32LE(chunkStart + 1);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (fourCc === "VP8 ") {
    // 3 bytes de frame tag + código de inicio 9d 01 2a, luego ancho/alto de
    // 14 bits (los 2 bits altos son el factor de escala) en LE.
    const start = chunkStart + 3;
    if (buf[start] !== 0x9d || buf[start + 1] !== 0x01 || buf[start + 2] !== 0x2a) {
      return null;
    }
    const width = buf.readUInt16LE(start + 3) & 0x3fff;
    const height = buf.readUInt16LE(start + 5) & 0x3fff;
    return { width, height };
  }
  return null;
}

export function getImageDimensions(
  buf: Buffer,
  mime: string
): ImageDimensions | null {
  try {
    if (mime === "image/png") return pngDimensions(buf);
    if (mime === "image/jpeg") return jpegDimensions(buf);
    if (mime === "image/webp") return webpDimensions(buf);
    return null;
  } catch {
    return null;
  }
}

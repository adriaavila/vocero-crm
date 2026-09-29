/**
 * Reescalado de fotos EN EL NAVEGADOR antes de subirlas.
 *
 * El `<canvas>` hace aquí el trabajo que si no exigiría un binario nativo de
 * procesamiento de imagen dentro del contenedor (Constitución II). Tras
 * reescalar a 1600 px y re-codificar a JPEG, prácticamente ninguna foto de
 * celular se acerca al tope de 3 MB de la API.
 *
 * Portado sin cambios del fork inmobiliario (`vocero-inmobiliario-main`,
 * `components/realty/resize-image.ts`): es browser-only y no depende de nada
 * del servidor.
 */

export const MAX_PHOTOS_PER_PROPERTY = 15;
export const MAX_PHOTO_BYTES = 3 * 1024 * 1024;
export const ACCEPTED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

const MAX_SIDE = 1600;
const JPEG_QUALITY = 0.85;

export type PreparedPhoto =
  | { ok: true; mimeType: "image/jpeg"; data: string; byteSize: number }
  | { ok: false; message: string };

/** Bytes reales de una cadena base64 (sin el prefijo `data:`). */
function base64Bytes(base64: string): number {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

function loadImage(file: File): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    image.src = url;
  });
}

/**
 * Valida y reescala UNA foto. Nunca lanza: devuelve el error como dato para
 * que quien sube varias pueda seguir con las demás.
 */
export async function preparePhoto(file: File): Promise<PreparedPhoto> {
  if (!(ACCEPTED_MIME_TYPES as readonly string[]).includes(file.type)) {
    return {
      ok: false,
      message: `${file.name}: solo se aceptan imágenes JPEG, PNG o WebP`,
    };
  }

  const image = await loadImage(file);
  if (!image || image.width === 0 || image.height === 0) {
    return { ok: false, message: `${file.name}: la imagen no se pudo leer` };
  }

  const scale = Math.min(1, MAX_SIDE / Math.max(image.width, image.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return {
      ok: false,
      message: `${file.name}: este navegador no pudo procesar la imagen`,
    };
  }
  // Fondo blanco antes de dibujar: un PNG con transparencia saldría con el
  // fondo en negro al re-codificarlo a JPEG.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

  const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
  const data = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const byteSize = base64Bytes(data);

  if (byteSize <= 0) {
    return { ok: false, message: `${file.name}: la imagen quedó vacía` };
  }
  if (byteSize > MAX_PHOTO_BYTES) {
    return {
      ok: false,
      message: `${file.name}: pesa ${(byteSize / 1024 / 1024).toFixed(
        1
      )} MB incluso reescalada (máximo 3 MB)`,
    };
  }

  return { ok: true, mimeType: "image/jpeg", data, byteSize };
}

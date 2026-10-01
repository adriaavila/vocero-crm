import { asc, eq, gt, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { getImageDimensions } from "@/server/storage/image-dimensions";
import { deleteObject, propertyPhotoKey, publicUrl, putObject } from "@/server/storage/r2";
import { getProperty } from "@/server/realty/properties";

/**
 * Fotos de propiedades (vertical inmobiliario, parte 1).
 *
 * El binario vive en el conector de almacenamiento (`server/storage/r2.ts`,
 * Cloudflare R2 del operador del despliegue, o disco local bajo `MEDIA_DIR`
 * sin esas variables — Constitución II). Esta tabla solo guarda la llave y
 * los metadatos.
 *
 * Topes DUROS para que ni el respaldo ni la memoria del proceso se degraden:
 * 15 fotos por propiedad, 3 MB por foto, reescaladas en el navegador antes de
 * subir (`components/realty/resize-image.ts`).
 *
 * La PORTADA es la foto en posición 0. No hay bandera "es portada": una sola
 * fuente de verdad hace imposible tener dos portadas o ninguna.
 *
 * Portado y adaptado del fork inmobiliario (`vocero-inmobiliario-main`,
 * spec 003): ahí el binario vivía en Postgres (`data` en base64); aquí nunca
 * — ver la enmienda de `.specify/memory/constitution.md`.
 */

export const MAX_PHOTOS_PER_PROPERTY = 15;
export const MAX_PHOTO_BYTES = 3 * 1024 * 1024;
export const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

export class PhotoError extends Error {
  code: "not_found" | "too_large" | "too_many" | "bad_type" | "invalid";
  constructor(code: PhotoError["code"], message: string) {
    super(message);
    this.name = "PhotoError";
    this.code = code;
  }
}

export function isAllowedMimeType(value: string): value is AllowedMimeType {
  return (ALLOWED_MIME_TYPES as readonly string[]).includes(value);
}

/**
 * Valida una foto ANTES de tocar la base de datos ni el almacenamiento. Pura:
 * se puede probar sin Postgres y la usa tanto la API como el self-test.
 */
export function validatePhoto(input: {
  mimeType: string;
  byteSize: number;
  currentCount: number;
}): PhotoError | null {
  if (!isAllowedMimeType(input.mimeType)) {
    return new PhotoError(
      "bad_type",
      "Solo se aceptan imágenes JPEG, PNG o WebP"
    );
  }
  if (input.byteSize <= 0) {
    return new PhotoError("invalid", "El archivo está vacío");
  }
  if (input.byteSize > MAX_PHOTO_BYTES) {
    return new PhotoError(
      "too_large",
      `Cada foto debe pesar máximo 3 MB (esta pesa ${(input.byteSize / 1024 / 1024).toFixed(1)} MB)`
    );
  }
  if (input.currentCount >= MAX_PHOTOS_PER_PROPERTY) {
    return new PhotoError(
      "too_many",
      `Máximo ${MAX_PHOTOS_PER_PROPERTY} fotos por propiedad`
    );
  }
  return null;
}

/** Firma de los primeros bytes: el `mimeType` lo declara el cliente. */
export function matchesImageBytes(data: Buffer, mimeType: string): boolean {
  if (mimeType === "image/jpeg") return data.length > 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
  if (mimeType === "image/png") return data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (mimeType === "image/webp") return data.subarray(0, 4).toString("latin1") === "RIFF" && data.subarray(8, 12).toString("latin1") === "WEBP";
  return false;
}

export type PhotoRow = typeof schema.propertyPhoto.$inferSelect;

export async function listPhotos(
  organizationId: string,
  propertyId: string
): Promise<PhotoRow[]> {
  const db = getDb();
  return db
    .select()
    .from(schema.propertyPhoto)
    .where(
      scoped(
        schema.propertyPhoto.organizationId,
        organizationId,
        eq(schema.propertyPhoto.propertyId, propertyId)
      )
    )
    .orderBy(asc(schema.propertyPhoto.position));
}

/**
 * Da de alta una foto: valida, sube el binario al conector de almacenamiento
 * y solo entonces escribe la fila. Si el conector falla, no queda una fila
 * huérfana apuntando a un archivo que nunca llegó.
 *
 * La foto nueva se agrega al final; la primera de todas queda de portada.
 */
export async function addPhoto(
  organizationId: string,
  propertyId: string,
  input: { mimeType: string; data: Buffer; byteSize: number }
): Promise<PhotoRow> {
  const property = await getProperty(organizationId, propertyId);
  if (!property) throw new PhotoError("not_found", "Propiedad no encontrada");

  const existing = await listPhotos(organizationId, propertyId);
  const invalid = validatePhoto({
    mimeType: input.mimeType,
    byteSize: input.byteSize,
    currentCount: existing.length,
  });
  if (invalid) throw invalid;
  if (!matchesImageBytes(input.data, input.mimeType)) {
    throw new PhotoError("bad_type", "Solo se aceptan imágenes JPEG, PNG o WebP");
  }

  const photoId = newId("propertyPhoto");
  const storageKey = propertyPhotoKey(organizationId, propertyId, photoId, input.mimeType);
  const dimensions = getImageDimensions(input.data, input.mimeType);

  await putObject(storageKey, input.data, input.mimeType);

  try {
    const inserted = await getDb()
      .insert(schema.propertyPhoto)
      .values({
        id: photoId,
        organizationId,
        propertyId,
        position: existing.length,
        storageKey,
        mime: input.mimeType as AllowedMimeType,
        byteSize: input.byteSize,
        width: dimensions?.width ?? null,
        height: dimensions?.height ?? null,
      })
      .returning();
    return inserted[0]!;
  } catch (err) {
    // La fila no se pudo escribir (p. ej. tope de la BD): no dejar el binario
    // huérfano en el conector.
    await deleteObject(storageKey).catch(() => {});
    throw err;
  }
}

/**
 * Borra una foto (fila Y binario) y RENUMERA el resto para que las posiciones
 * queden `0..n-1` sin huecos. Si la borrada era la portada, la siguiente la
 * sustituye automáticamente — sin intervención del asesor.
 */
export async function deletePhoto(
  organizationId: string,
  photoId: string,
  propertyId?: string
): Promise<void> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.propertyPhoto)
    .where(
      scoped(
        schema.propertyPhoto.organizationId,
        organizationId,
        eq(schema.propertyPhoto.id, photoId)
      )
    )
    .limit(1);
  const photo = rows[0];
  if (!photo || (propertyId && photo.propertyId !== propertyId)) {
    throw new PhotoError("not_found", "Foto no encontrada");
  }

  await db.transaction(async (tx) => {
    await tx
      .delete(schema.propertyPhoto)
      .where(eq(schema.propertyPhoto.id, photo.id));
    // Cierra el hueco: todas las posteriores bajan una posición.
    await tx
      .update(schema.propertyPhoto)
      .set({ position: sql`${schema.propertyPhoto.position} - 1` })
      .where(
        scoped(
          schema.propertyPhoto.organizationId,
          organizationId,
          eq(schema.propertyPhoto.propertyId, photo.propertyId),
          gt(schema.propertyPhoto.position, photo.position)
        )
      );
  });
  // El binario se borra DESPUÉS de que la fila ya no existe: un fallo aquí dej
  // a lo sumo un objeto huérfano en el conector, nunca una foto sin binario.
  await deleteObject(photo.storageKey).catch(() => {});
}

/**
 * Mueve una foto a una posición y renumera el resto de forma transaccional.
 * "Marcar como principal" es simplemente moverla a la posición 0.
 *
 * El índice UNIQUE `(property_id, position)` obliga a pasar por un hueco
 * temporal negativo: sin él, el reordenamiento chocaría a mitad de camino.
 */
export async function movePhoto(
  organizationId: string,
  photoId: string,
  targetPosition: number,
  propertyId?: string
): Promise<void> {
  const db = getDb();
  const rows = await db
    .select({
      id: schema.propertyPhoto.id,
      propertyId: schema.propertyPhoto.propertyId,
      position: schema.propertyPhoto.position,
    })
    .from(schema.propertyPhoto)
    .where(
      scoped(
        schema.propertyPhoto.organizationId,
        organizationId,
        eq(schema.propertyPhoto.id, photoId)
      )
    )
    .limit(1);
  const photo = rows[0];
  if (!photo || (propertyId && photo.propertyId !== propertyId)) {
    throw new PhotoError("not_found", "Foto no encontrada");
  }

  const siblings = await listPhotos(organizationId, photo.propertyId);
  const target = Math.max(0, Math.min(targetPosition, siblings.length - 1));
  if (target === photo.position) return;

  const reordered = siblings.filter((p) => p.id !== photo.id);
  reordered.splice(target, 0, siblings.find((p) => p.id === photo.id)!);

  await db.transaction(async (tx) => {
    // Paso 1: sacar todas las posiciones del rango válido (negativas).
    await tx
      .update(schema.propertyPhoto)
      .set({ position: sql`-1 - ${schema.propertyPhoto.position}` })
      .where(eq(schema.propertyPhoto.propertyId, photo.propertyId));
    // Paso 2: escribir el orden definitivo.
    for (const [index, item] of reordered.entries()) {
      await tx
        .update(schema.propertyPhoto)
        .set({ position: index })
        .where(eq(schema.propertyPhoto.id, item.id));
    }
  });
}

export function serializePhoto(photo: PhotoRow) {
  return {
    id: photo.id,
    propertyId: photo.propertyId,
    position: photo.position,
    isCover: photo.position === 0,
    mime: photo.mime,
    byteSize: photo.byteSize,
    width: photo.width,
    height: photo.height,
    url: publicUrl(photo.storageKey),
  };
}

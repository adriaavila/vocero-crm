import { z } from "zod";
import { apiError, parseBody } from "@/lib/api";
import { withRealty } from "@/server/realty/guard";
import {
  ALLOWED_MIME_TYPES,
  MAX_PHOTO_BYTES,
  PhotoError,
  addPhoto,
  listPhotos,
  serializePhoto,
} from "@/server/realty/photos";
import { StorageError } from "@/server/storage/r2";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * Alta de foto. El navegador reescala a 1600 px y re-codifica a JPEG antes de
 * subir (`components/realty/resize-image.ts`), así que llega en base64 y casi
 * nunca se acerca al tope de 3 MB. La API sigue aceptando PNG/WebP para quien
 * suba directo (mismo catálogo que `property_photo.mime`).
 */
const PhotoUploadSchema = z.object({
  mimeType: z.enum(ALLOWED_MIME_TYPES),
  /** Bytes en base64, sin el prefijo `data:`. */
  data: z
    .string()
    .min(1)
    .max(Math.ceil((MAX_PHOTO_BYTES * 4) / 3) + 1024, "La foto excede 3 MB"),
});

export const GET = withRealty(async (session, _req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const photos = await listPhotos(session.organizationId, id);
  return Response.json({ photos: photos.map(serializePhoto) });
});

export const POST = withRealty(async (session, req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const parsed = await parseBody(req, PhotoUploadSchema);
  if (!parsed.ok) return parsed.response;

  const data = parsed.data.data.replace(/^data:[^;]+;base64,/, "");
  const buffer = Buffer.from(data, "base64");

  try {
    const photo = await addPhoto(session.organizationId, id, {
      mimeType: parsed.data.mimeType,
      data: buffer,
      byteSize: buffer.byteLength,
    });
    return Response.json({ photo: serializePhoto(photo) }, { status: 201 });
  } catch (err) {
    if (err instanceof PhotoError) {
      const status = err.code === "not_found" ? 404 : 422;
      return apiError(status, err.code, err.message);
    }
    if (err instanceof StorageError) {
      return apiError(502, "storage_failed", err.message);
    }
    throw err;
  }
});

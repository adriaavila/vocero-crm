import { z } from "zod";
import { apiError, parseBody } from "@/lib/api";
import { withRealty } from "@/server/realty/guard";
import {
  PhotoError,
  deletePhoto,
  listPhotos,
  movePhoto,
  serializePhoto,
} from "@/server/realty/photos";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; photoId: string }> };

/** Mover a la posición 0 es "marcar como principal": la portada ES la 0. */
const MoveSchema = z.object({ position: z.number().int().min(0) });

export const PATCH = withRealty(async (session, req: Request, ctx: Params) => {
  const { id, photoId } = await ctx.params;
  const parsed = await parseBody(req, MoveSchema);
  if (!parsed.ok) return parsed.response;

  try {
    await movePhoto(session.organizationId, photoId, parsed.data.position);
    const photos = await listPhotos(session.organizationId, id);
    return Response.json({ photos: photos.map(serializePhoto) });
  } catch (err) {
    if (err instanceof PhotoError) {
      return apiError(404, err.code, err.message);
    }
    throw err;
  }
});

/** Al borrar la portada, la siguiente la sustituye automáticamente. */
export const DELETE = withRealty(async (session, _req: Request, ctx: Params) => {
  const { id, photoId } = await ctx.params;
  try {
    await deletePhoto(session.organizationId, photoId);
    const photos = await listPhotos(session.organizationId, id);
    return Response.json({ photos: photos.map(serializePhoto) });
  } catch (err) {
    if (err instanceof PhotoError) {
      return apiError(404, err.code, err.message);
    }
    throw err;
  }
});

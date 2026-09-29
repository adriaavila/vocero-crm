import { apiError, parseBody } from "@/lib/api";
import { withRealty } from "@/server/realty/guard";
import { listPhotos, serializePhoto } from "@/server/realty/photos";
import {
  PropertyError,
  PropertyPatchSchema,
  getProperty,
  serializeProperty,
  setArchived,
  updateProperty,
} from "@/server/realty/properties";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export const GET = withRealty(async (session, _req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const property = await getProperty(session.organizationId, id);
  // Una propiedad de otra organización responde 404, no 403: no se filtra
  // siquiera su existencia (Constitución I).
  if (!property) return apiError(404, "not_found", "Propiedad no encontrada");

  const photos = await listPhotos(session.organizationId, id);
  return Response.json({
    property: serializeProperty(property, {
      photoCount: photos.length,
      coverPhotoUrl: photos[0] ? serializePhoto(photos[0]).url : null,
    }),
    photos: photos.map(serializePhoto),
  });
});

export const PATCH = withRealty(async (session, req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const parsed = await parseBody(req, PropertyPatchSchema);
  if (!parsed.ok) return parsed.response;

  try {
    const property = await updateProperty(
      session.organizationId,
      id,
      parsed.data
    );
    return Response.json({ property: serializeProperty(property) });
  } catch (err) {
    if (err instanceof PropertyError) {
      return apiError(
        err.code === "not_found" ? 404 : 422,
        err.code,
        err.message
      );
    }
    throw err;
  }
});

/**
 * "Quitar" es ARCHIVAR, nunca borrar: el historial (conversaciones, visitas,
 * fichas ya enviadas — parte 2) sigue siendo válido y la propiedad se puede
 * recuperar con su estatus comercial intacto.
 */
export const DELETE = withRealty(async (session, _req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  try {
    const property = await setArchived(session.organizationId, id, true);
    return Response.json({ property: serializeProperty(property) });
  } catch (err) {
    if (err instanceof PropertyError) {
      return apiError(404, "not_found", err.message);
    }
    throw err;
  }
});

/** Desarchivar: vuelve con el estatus que tenía antes. */
export const PUT = withRealty(async (session, _req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  try {
    const property = await setArchived(session.organizationId, id, false);
    return Response.json({ property: serializeProperty(property) });
  } catch (err) {
    if (err instanceof PropertyError) {
      return apiError(404, "not_found", err.message);
    }
    throw err;
  }
});

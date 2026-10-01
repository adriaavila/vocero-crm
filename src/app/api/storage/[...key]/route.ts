import { apiError, withAuth } from "@/lib/api";
import { getLocalObject, isSafeStorageKey } from "@/server/storage/r2";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ key: string[] }> };

const MIME_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

/**
 * Camino sin dependencia externa del conector de fotos (`server/storage/r2.ts`,
 * Constitución II): sirve el binario desde `MEDIA_DIR` cuando R2 no está
 * configurado. Con R2 activo esta ruta nunca se usa — `publicUrl()` devuelve
 * directo el dominio público del bucket.
 *
 * Autenticada y escopeada por el PRIMER segmento de la llave
 * (`org/<organizationId>/...`, la misma disposición que usa el conector): la
 * llave de otra organización responde 404, nunca 403 — no se filtra ni su
 * existencia (Constitución I), igual que `/api/media/[assetId]`.
 */
export const GET = withAuth(async (session, _req: Request, ctx: Params) => {
  const { key: segments } = await ctx.params;
  if (segments.length < 2 || segments[0] !== "org" || segments[1] !== session.organizationId) {
    return apiError(404, "not_found", "Archivo no encontrado");
  }
  const key = segments.join("/");
  if (!isSafeStorageKey(key)) {
    return apiError(404, "not_found", "Archivo no encontrado");
  }

  const data = await getLocalObject(key);
  if (!data) return apiError(404, "not_found", "Archivo no encontrado");

  const ext = key.slice(key.lastIndexOf(".") + 1).toLowerCase();
  const contentType = MIME_BY_EXT[ext] ?? "application/octet-stream";
  return new Response(new Uint8Array(data), {
    headers: {
      "content-type": contentType,
      "content-length": String(data.byteLength),
      // El contenido es inmutable (una foto nunca se sobrescribe, se borra y
      // se sube otra con id nuevo); privado por sesión.
      "cache-control": "private, max-age=86400",
    },
  });
});

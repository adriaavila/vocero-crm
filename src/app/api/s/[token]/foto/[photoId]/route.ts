import { apiError } from "@/lib/api";
import { fotoDeSala, salaVentaEnabled } from "@/server/agencia/sala-venta";
import { getLocalObject, isSafeStorageKey } from "@/server/storage/r2";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ token: string; photoId: string }> };

/**
 * Fotos de la sala cuando el almacenamiento es el disco local (sin R2, la
 * ruta normal `/api/storage` pide sesión). Solo sirve fotos de las casas que
 * están en ESA sala: el token no abre el resto del catálogo.
 */
export async function GET(_req: Request, ctx: Params) {
  if (!salaVentaEnabled()) return new Response(null, { status: 404 });
  const { token, photoId } = await ctx.params;
  const foto = await fotoDeSala(token, photoId);
  if (!foto || !isSafeStorageKey(foto.storageKey)) {
    return apiError(404, "not_found", "Foto no encontrada");
  }
  const data = await getLocalObject(foto.storageKey);
  if (!data) return apiError(404, "not_found", "Foto no encontrada");
  return new Response(new Uint8Array(data), {
    headers: {
      "content-type": foto.mime,
      "content-length": String(data.byteLength),
      "cache-control": "public, max-age=86400",
    },
  });
}

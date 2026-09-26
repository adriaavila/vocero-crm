import { readFile, stat } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { apiError } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { mediaFilePath } from "@/server/whatsapp/media";

/**
 * Capa de agencia — el adjunto que pide el cerebro externo, desde el disco.
 *
 * La ingesta ya guarda cada adjunto en MEDIA_DIR (`media_asset`, 008). Pedirlo
 * otra vez a Graph en cada turno de Nea gasta llamadas, y no sirve para una
 * organización sin WhatsApp conectado (Instagram, Messenger): esas
 * credenciales no existen. Aquí se sirve la copia de ESTA organización.
 *
 * `null` = no hay copia local utilizable y quien llama cae a Graph.
 */
export async function adjuntoLocal(
  organizationId: string,
  waMediaId: string,
  maxBytes: number
): Promise<Response | null> {
  const rows = await getDb()
    .select()
    .from(schema.mediaAsset)
    .where(
      scoped(
        schema.mediaAsset.organizationId,
        organizationId,
        eq(schema.mediaAsset.waMediaId, waMediaId),
        // Solo copias terminadas: mientras la ingesta descarga, el archivo
        // puede estar a medias en el disco.
        eq(schema.mediaAsset.fetchStatus, "available")
      )
    )
    .limit(1);
  const asset = rows[0];
  if (!asset) return null;

  let data: Buffer;
  try {
    // La ruta sale de la org que pide, no de la fila: el disco también separa.
    const file = mediaFilePath(organizationId, asset.id);
    // El tamaño real y antes de leer: un documento de 100 MB no se sube a
    // memoria para rechazarlo.
    if ((await stat(file)).size > maxBytes) {
      return apiError(
        413,
        "too_large",
        `El adjunto excede el límite de ${maxBytes / (1024 * 1024)} MB`
      );
    }
    data = await readFile(file);
  } catch {
    console.warn(
      `[media] el asset ${asset.id} figura disponible pero no está en el volumen; se pide a Graph`
    );
    return null;
  }

  return new Response(new Uint8Array(data), {
    headers: {
      "content-type": asset.mimeType ?? "application/octet-stream",
      "cache-control": "no-store",
    },
  });
}

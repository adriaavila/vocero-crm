import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { getEnv, isR2Configured } from "@/lib/env";
import { amzDateNow, encodeCanonicalPath, sha256HexOf, signRequest } from "@/server/storage/sigv4";

/**
 * Fotos de propiedades: conector opcional de almacenamiento de objetos
 * (Cloudflare R2, S3-compatible) DEL OPERADOR del despliegue — no de cada
 * negocio, a diferencia de Zoom/Google (ver la enmienda de
 * `.specify/memory/constitution.md`, Principio VIII). Contrato público
 * estable de tres operaciones (`putObject`, `deleteObject`, `publicUrl`);
 * `server/realty/photos.ts` es el único módulo que lo llama, así que cambiar
 * de proveedor —o volver al camino sin dependencia externa— nunca toca el
 * dominio.
 *
 * Sin las 5 variables de entorno (`isR2Configured()` en `false`, el caso por
 * defecto de cualquier instancia — incluida allok, que ni siquiera activa el
 * vertical), cae al camino sin dependencia externa: disco local bajo
 * `MEDIA_DIR`, con la MISMA disposición de llaves
 * (`org/<orgId>/properties/<propertyId>/<photoId>.<ext>`) y servido por la
 * ruta autenticada `/api/storage/[...key]` — igual que ya hacen los adjuntos
 * de WhatsApp (`server/whatsapp/media.ts`). El fallo de R2 nunca bloquea: si
 * el PUT/DELETE remoto falla, se lanza un error tipado y quien llama decide
 * (la API responde 502, la propiedad y sus demás fotos siguen intactas).
 */

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export function extensionForMime(mime: string): string {
  return EXT_BY_MIME[mime] ?? "bin";
}

/** `org/<orgId>/properties/<propertyId>/<photoId>.<ext>` — igual en R2 y en disco. */
export function propertyPhotoKey(
  organizationId: string,
  propertyId: string,
  photoId: string,
  mime: string
): string {
  return `org/${organizationId}/properties/${propertyId}/${photoId}.${extensionForMime(mime)}`;
}

export class StorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorageError";
  }
}

/** URL con la que se muestra la foto: pública (R2) o autenticada (disco local). */
export function publicUrl(key: string): string {
  if (isR2Configured()) {
    const base = getEnv().R2_PUBLIC_BASE_URL!.replace(/\/+$/, "");
    return `${base}/${key}`;
  }
  return `/api/storage/${key}`;
}

async function r2Request(
  method: "PUT" | "DELETE",
  key: string,
  body?: Buffer,
  contentType?: string
): Promise<void> {
  const env = getEnv();
  const accountId = env.R2_ACCOUNT_ID!;
  const bucket = env.R2_BUCKET!;
  const host = `${accountId}.r2.cloudflarestorage.com`;
  const canonicalPath = encodeCanonicalPath(`/${bucket}/${key}`);
  const amzDate = amzDateNow();
  const payloadHashHex = body ? sha256HexOf(body) : "UNSIGNED-PAYLOAD";
  const headers: Record<string, string> = {
    "x-amz-content-sha256": payloadHashHex,
    "x-amz-date": amzDate,
  };
  if (contentType) headers["content-type"] = contentType;

  const { authorization } = signRequest({
    method,
    host,
    canonicalPath,
    headers,
    payloadHashHex,
    accessKeyId: env.R2_ACCESS_KEY_ID!,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
    region: "auto",
    service: "s3",
    amzDate,
  });

  let res: Response;
  try {
    res = await fetch(`https://${host}${canonicalPath}`, {
      method,
      headers: { ...headers, authorization },
      body: body ? new Uint8Array(body) : undefined,
    });
  } catch (cause) {
    throw new StorageError(
      `No se pudo contactar R2 (${method} ${key}): ${(cause as Error).message}`
    );
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new StorageError(
      `R2 respondió ${res.status} en ${method} ${key}${detail ? `: ${detail.slice(0, 300)}` : ""}`
    );
  }
}

/* ---------- Camino sin dependencia externa: disco bajo MEDIA_DIR ---------- */

export function isSafeStorageKey(key: string): boolean {
  return (
    /^org\/[\w.-]+\/properties\/[\w.-]+\/[\w.-]+$/.test(key) &&
    !key.split("/").some((segment) => segment === "." || segment === "..")
  );
}

function assertSafeKey(key: string): void {
  // Mismos segmentos que arma `propertyPhotoKey`: org/<id>/properties/<id>/<archivo>.
  // Nunca `..` ni una barra invertida — nada que se salga de MEDIA_DIR.
  if (!isSafeStorageKey(key)) {
    throw new StorageError(`llave de almacenamiento inválida: ${key}`);
  }
}

function localFilePath(key: string): string {
  assertSafeKey(key);
  return path.join(getEnv().MEDIA_DIR, key);
}

async function putLocal(key: string, data: Buffer): Promise<void> {
  const file = localFilePath(key);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, data);
}

async function deleteLocal(key: string): Promise<void> {
  await rm(localFilePath(key), { force: true });
}

/** Solo la usa la ruta local (`/api/storage/[...key]`): R2 nunca pasa por el servidor. */
export async function getLocalObject(
  key: string
): Promise<Buffer | null> {
  try {
    return await readFile(localFilePath(key));
  } catch {
    return null;
  }
}

/* ---------- Contrato público ---------- */

export async function putObject(
  key: string,
  data: Buffer,
  contentType: string
): Promise<void> {
  if (isR2Configured()) {
    await r2Request("PUT", key, data, contentType);
    return;
  }
  await putLocal(key, data);
}

export async function deleteObject(key: string): Promise<void> {
  if (isR2Configured()) {
    await r2Request("DELETE", key);
    return;
  }
  await deleteLocal(key);
}

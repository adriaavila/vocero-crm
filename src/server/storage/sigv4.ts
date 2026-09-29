import { createHash, createHmac } from "node:crypto";

/**
 * Firma AWS Signature Version 4, a mano.
 *
 * Por qué no una dependencia (`aws4fetch` o el SDK de AWS): R2 solo necesita
 * TRES operaciones (`putObject`, `deleteObject`, y nada de lectura firmada —
 * la portada se sirve por el dominio público del bucket). El algoritmo son
 * cinco pasos documentados y estables desde 2013 (canonicalizar, hashear,
 * derivar la llave con una cadena de HMAC, firmar) — "un par de líneas que ya
 * hacen esto" en vez de una dependencia nueva para un adaptador que además
 * tiene que poder no existir del todo (Constitución II: conector opcional,
 * apagado sin las variables de entorno). El mismo criterio que ya usa este
 * repo en `lib/crypto` (AES-256-GCM a mano, sin una librería de cifrado).
 *
 * Verificado contra el vector de prueba OFICIAL de AWS (Amazon S3 — "Example:
 * GET Object", mismo algoritmo que R2 implementa): ver
 * `tests/unit/realty-storage.test.ts`.
 */

const ALGORITHM = "AWS4-HMAC-SHA256";

export const EMPTY_PAYLOAD_SHA256 =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

function sha256Hex(data: string | Buffer | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

export function sha256HexOf(body: Buffer | Uint8Array | string): string {
  return sha256Hex(body);
}

/**
 * `encodeURIComponent` codifica todo lo que SigV4 pide, salvo que además hay
 * que codificar `!`, `*`, `'`, `(`, `)` — RFC 3986 los deja "sin reservar" y
 * `encodeURIComponent` los deja tal cual. Usado para la query string y para
 * cada SEGMENTO de la ruta (nunca la barra `/` que separa segmentos).
 */
function uriEncode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!*'()]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

/** Codifica una ruta absoluta (`/bucket/carpeta/archivo.jpg`) segmento a segmento. */
export function encodeCanonicalPath(path: string): string {
  return path
    .split("/")
    .map((segment) => uriEncode(segment))
    .join("/");
}

function canonicalQueryString(query: Record<string, string> | undefined): string {
  if (!query || Object.keys(query).length === 0) return "";
  return Object.keys(query)
    .sort()
    .map((k) => `${uriEncode(k)}=${uriEncode(query[k] ?? "")}`)
    .join("&");
}

export type SigV4Request = {
  method: string;
  /** Host SigV4 (ej.: `<accountId>.r2.cloudflarestorage.com`). */
  host: string;
  /** Ruta absoluta YA codificada por segmento (ver `encodeCanonicalPath`). */
  canonicalPath: string;
  query?: Record<string, string>;
  /**
   * Cabeceras a firmar, tal cual se van a mandar (sin `host`: la agrega esta
   * función). Los nombres se normalizan a minúsculas y se ordenan aquí.
   */
  headers: Record<string, string>;
  /** Hex del SHA-256 del body, o `"UNSIGNED-PAYLOAD"`. */
  payloadHashHex: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  service: string;
  /** `YYYYMMDDTHHMMSSZ`, UTC. Inyectable para que el test use la fecha del vector. */
  amzDate: string;
};

export type SigV4Signature = {
  authorization: string;
  canonicalRequest: string;
  stringToSign: string;
  signedHeaders: string;
  credentialScope: string;
};

/** Deriva la llave de firma: HMAC encadenado fecha → región → servicio → request. */
export function signingKey(
  secretAccessKey: string,
  dateStamp: string,
  region: string,
  service: string
): Buffer {
  const kDate = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, "aws4_request");
}

/** Firma UNA petición SigV4 y arma su cabecera `Authorization`. */
export function signRequest(req: SigV4Request): SigV4Signature {
  const dateStamp = req.amzDate.slice(0, 8);
  const allHeaders: Record<string, string> = {
    ...req.headers,
    host: req.host,
  };
  const headerNames = Object.keys(allHeaders)
    .map((h) => h.toLowerCase())
    .sort();
  const lowerHeaders = new Map(
    Object.entries(allHeaders).map(([k, v]) => [k.toLowerCase(), v.trim()])
  );
  const canonicalHeaders = headerNames
    .map((h) => `${h}:${lowerHeaders.get(h) ?? ""}\n`)
    .join("");
  const signedHeaders = headerNames.join(";");

  const canonicalRequest = [
    req.method.toUpperCase(),
    req.canonicalPath,
    canonicalQueryString(req.query),
    canonicalHeaders,
    signedHeaders,
    req.payloadHashHex,
  ].join("\n");

  const credentialScope = `${dateStamp}/${req.region}/${req.service}/aws4_request`;
  const stringToSign = [
    ALGORITHM,
    req.amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const key = signingKey(req.secretAccessKey, dateStamp, req.region, req.service);
  const signature = hmac(key, stringToSign).toString("hex");

  const authorization =
    `${ALGORITHM} Credential=${req.accessKeyId}/${credentialScope},` +
    `SignedHeaders=${signedHeaders},Signature=${signature}`;

  return { authorization, canonicalRequest, stringToSign, signedHeaders, credentialScope };
}

/** `YYYYMMDDTHHMMSSZ` de un instante, como lo pide `x-amz-date`. */
export function amzDateNow(now: Date = new Date()): string {
  return now.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

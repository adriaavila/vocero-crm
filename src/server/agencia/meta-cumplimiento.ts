import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { getEnv } from "@/lib/env";
import { markReconnectRequired } from "@/server/whatsapp/credentials";

/**
 * Fork — webhooks de cumplimiento de Meta (los dos que pide la revisión de la
 * app): "Desautorizar" (la persona quitó la app de su Facebook) y "Solicitud
 * de eliminación de datos". Ambos llegan como `signed_request` en un POST de
 * formulario, firmado con HMAC-SHA256 usando el secreto de la app. Se verifica
 * aquí mismo con `META_APP_SECRET`, igual que el webhook de mensajes: no hace
 * falta un Worker aparte que lo verifique antes.
 *
 * Qué hace cada uno:
 * - Desautorizar: los negocios que esa persona conectó quedan en "reconectar"
 *   (el token ya no sirve, y el dueño ve que tiene que volver a conectar).
 *   Nada se borra: es reversible.
 * - Borrar datos: se registra con un código y Meta le enseña a la persona un
 *   enlace para ver el estado. El borrado de un negocio NO es automático (es
 *   irreversible y se confirma con el titular): lo hace el operador y marca la
 *   solicitud como hecha.
 */

export type SignedRequest = {
  algorithm?: string;
  user_id?: string;
  issued_at?: number;
  [k: string]: unknown;
};

function base64UrlDecode(input: string): Buffer {
  const b64 = input.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(b64 + "=".repeat((4 - (b64.length % 4)) % 4), "base64");
}

/**
 * `<firma>.<payload>` en base64url; la firma es HMAC-SHA256 del payload TAL
 * COMO LLEGA (en base64url) con el secreto de la app. `null` ante cualquier
 * cosa que no cuadre: firma, algoritmo, JSON o falta de `user_id`.
 */
export function parseSignedRequest(signedRequest: string, appSecret: string): SignedRequest | null {
  const [sig, payload, ...rest] = signedRequest.split(".");
  if (!sig || !payload || rest.length > 0 || !appSecret) return null;
  const expected = createHmac("sha256", appSecret).update(payload).digest();
  const provided = base64UrlDecode(sig);
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;
  let data: SignedRequest;
  try {
    data = JSON.parse(base64UrlDecode(payload).toString("utf8")) as SignedRequest;
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;
  if (String(data.algorithm ?? "").toUpperCase() !== "HMAC-SHA256") return null;
  if (typeof data.user_id !== "string" || data.user_id.length === 0) return null;
  return data;
}

/** Lee `signed_request` de un POST (formulario, que es lo que manda Meta, o JSON). */
export async function readSignedRequest(request: Request): Promise<string | null> {
  const type = request.headers.get("content-type") ?? "";
  try {
    if (type.includes("application/json")) {
      const body = (await request.json()) as { signed_request?: unknown };
      return typeof body.signed_request === "string" ? body.signed_request : null;
    }
    const form = new URLSearchParams(await request.text());
    return form.get("signed_request");
  } catch {
    return null;
  }
}

export async function recordarAutorizacion(organizationId: string, fbUserId: string): Promise<void> {
  const now = new Date();
  await getDb()
    .insert(schema.metaAutorizacion)
    .values({ organizationId, fbUserId, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: schema.metaAutorizacion.organizationId,
      set: { fbUserId, updatedAt: now },
    });
}

async function negociosDe(fbUserId: string): Promise<string[]> {
  const rows = await getDb()
    .select({ organizationId: schema.metaAutorizacion.organizationId })
    .from(schema.metaAutorizacion)
    .where(eq(schema.metaAutorizacion.fbUserId, fbUserId));
  return rows.map((r) => r.organizationId);
}

function nuevoCodigo(): string {
  // Lo ve la persona: corto, sin letras confundibles, y no adivinable.
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(10);
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}

async function registrar(
  tipo: "desautorizar" | "eliminar_datos",
  data: SignedRequest,
  organizationIds: string[]
): Promise<string> {
  const codigo = nuevoCodigo();
  await getDb()
    .insert(schema.metaSolicitud)
    .values({
      id: newId("metaSolicitud"),
      tipo,
      fbUserId: data.user_id as string,
      codigo,
      organizationIds,
      issuedAt: typeof data.issued_at === "number" ? new Date(data.issued_at * 1000) : null,
      estado: tipo === "desautorizar" ? "hecha" : "recibida",
      doneAt: tipo === "desautorizar" ? new Date() : null,
    });
  return codigo;
}

export async function desautorizar(data: SignedRequest): Promise<{ codigo: string; negocios: number }> {
  const orgs = await negociosDe(data.user_id as string);
  for (const org of orgs) await markReconnectRequired(org);
  const codigo = await registrar("desautorizar", data, orgs);
  return { codigo, negocios: orgs.length };
}

export async function solicitarBorrado(data: SignedRequest): Promise<{ url: string; codigo: string }> {
  const orgs = await negociosDe(data.user_id as string);
  const codigo = await registrar("eliminar_datos", data, orgs);
  const url = new URL(`/solicitud-datos?codigo=${codigo}`, getEnv().APP_BASE_URL).toString();
  return { url, codigo };
}

export type EstadoSolicitud = {
  tipo: "desautorizar" | "eliminar_datos";
  estado: "recibida" | "hecha";
  recibida: Date;
  hecha: Date | null;
};

/** Para la página pública de estado: solo lo que la persona necesita ver. */
export async function estadoSolicitud(codigo: string): Promise<EstadoSolicitud | null> {
  const limpio = codigo.trim().toUpperCase();
  if (!/^[A-Z0-9]{6,20}$/.test(limpio)) return null;
  const [row] = await getDb()
    .select()
    .from(schema.metaSolicitud)
    .where(eq(schema.metaSolicitud.codigo, limpio))
    .limit(1);
  if (!row) return null;
  return { tipo: row.tipo, estado: row.estado, recibida: row.createdAt, hecha: row.doneAt };
}

/** El operador marca hecha una solicitud de borrado tras borrar los negocios. */
export async function marcarSolicitudHecha(codigos: string[]): Promise<void> {
  if (codigos.length === 0) return;
  await getDb()
    .update(schema.metaSolicitud)
    .set({ estado: "hecha", doneAt: new Date() })
    .where(inArray(schema.metaSolicitud.codigo, codigos));
}

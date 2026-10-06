import { z } from "zod";
import { ORIGEN_KEYS, type OrigenAlta, type OrigenGuardado } from "@/lib/origen-alta-claves";

/**
 * Capa de agencia (fork) — de dónde llegó un alta del SaaS: las UTM, el
 * código de referido, el clic de anuncio, la página de entrada y el sitio que
 * lo mandó. Puro y sin servidor: el formulario de registro lo usa en el
 * navegador (qué claves capturar) y el servidor lo usa para limpiar lo que
 * llega antes de guardarlo (`server/agencia/origen-alta.ts`).
 */

export { ORIGEN_KEYS } from "@/lib/origen-alta-claves";
export type { OrigenAlta, OrigenGuardado, OrigenKey } from "@/lib/origen-alta-claves";

/** fbclid y gclid pueden ser largos; 200 alcanza y no deja meter un libro. */
export const ORIGEN_MAX = 200;

const ROOT_DOMAIN = "allok.fun";

/** Texto recortado y con tope; cualquier otra cosa (número, objeto, vacío) se descarta. */
const texto = z
  .string()
  .transform((value) => value.trim().slice(0, ORIGEN_MAX))
  .optional()
  .catch(undefined);

/** Solo el host del que llegó: la ruta y la query del sitio ajeno no son nuestras. */
function hostDe(value: string): string | undefined {
  const raw = value.trim();
  if (!raw) return undefined;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
    const host = url.hostname.toLowerCase();
    const valido = /^[a-z0-9.-]+$/.test(host) && (host.includes(".") || host === "localhost");
    return valido ? host : undefined;
  } catch {
    return undefined;
  }
}

/**
 * La página de entrada es una ruta de allok.fun: o la ruta tal cual
 * (`/precios`), o una URL de allok.fun (o un subdominio) de la que se toma la
 * ruta. Una URL de otro sitio no es una página nuestra y se descarta.
 */
function rutaDe(value: string): string | undefined {
  const raw = value.trim();
  if (!raw) return undefined;
  if (raw.startsWith("/") && !raw.startsWith("//")) return raw.split(/[?#]/)[0] || "/";
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    if (host !== ROOT_DOMAIN && !host.endsWith(`.${ROOT_DOMAIN}`)) return undefined;
    return url.pathname || "/";
  } catch {
    return undefined;
  }
}

const origenSchema = z.object({
  utm_source: texto,
  utm_medium: texto,
  utm_campaign: texto,
  utm_content: texto,
  utm_term: texto,
  ref: texto,
  fbclid: texto,
  gclid: texto,
  landing: texto.transform((value) => (value ? rutaDe(value)?.slice(0, ORIGEN_MAX) : undefined)),
  referrer: texto.transform((value) => (value ? hostDe(value)?.slice(0, ORIGEN_MAX) : undefined)),
});

/**
 * Limpia un origen que llega de afuera: solo las claves de la lista, texto
 * recortado y con tope, el referente reducido a su host, vacíos fuera. Si no
 * queda nada, `null` (no hay nada que guardar).
 */
export function parseOrigen(input: unknown): OrigenAlta | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const parsed = origenSchema.safeParse(input);
  if (!parsed.success) return null;
  const origen: OrigenAlta = {};
  for (const key of ORIGEN_KEYS) {
    const value = parsed.data[key];
    if (value) origen[key] = value;
  }
  return Object.keys(origen).length > 0 ? origen : null;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** Lee `metadata.allok.origen` del texto JSON de la organización; `null` si no hay o está roto. */
export function origenFromMetadata(raw: string | null | undefined): OrigenGuardado | null {
  if (!raw) return null;
  let metadata: unknown;
  try {
    metadata = JSON.parse(raw);
  } catch {
    return null;
  }
  const stored = asObject(asObject(asObject(metadata)?.allok)?.origen);
  if (!stored) return null;
  const origen = parseOrigen(stored);
  if (!origen) return null;
  return { ...origen, at: typeof stored.at === "string" ? stored.at : "" };
}

/**
 * El canal con el que se cuenta un alta en el embudo: la UTM manda; si no hay,
 * el código de referido; si no, el sitio que lo mandó; si no, «directo».
 * En minúsculas para que «Facebook» y «facebook» sumen en la misma fila.
 */
export function fuenteDeOrigen(origen: OrigenAlta | null | undefined): string {
  if (origen?.utm_source) return origen.utm_source.toLowerCase();
  if (origen?.ref) return `ref:${origen.ref}`;
  if (origen?.referrer) return origen.referrer.toLowerCase();
  return "directo";
}

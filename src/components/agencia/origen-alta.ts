import { ORIGEN_KEYS, type OrigenAlta } from "@/lib/origen-alta-claves";

/**
 * Capa de agencia — el lado del navegador del origen del alta. El registro
 * llama `capturarOrigenAlta()` al abrirse y `enviarOrigenAlta()` justo después
 * de crear la cuenta. Ninguna de las dos lanza: el rastreo nunca frena un alta.
 */

const STORAGE_KEY = "allok:origen-alta";
const TIMEOUT_MS = 2500;

/** Lo que trae la URL de entrada + el sitio que mandó al visitante (si no es este mismo). */
export function origenDesdeNavegador(search: string, referrer: string, origin: string, pathname: string): OrigenAlta {
  const params = new URLSearchParams(search);
  const origen: OrigenAlta = {};
  for (const key of ORIGEN_KEYS) {
    if (key === "referrer") continue;
    const value = params.get(key);
    if (value) origen[key] = value;
  }
  if (!origen.landing) origen.landing = pathname;
  try {
    const ref = referrer ? new URL(referrer) : null;
    if (ref && ref.origin !== origin) origen.referrer = ref.hostname;
  } catch {
    // Referente ilegible: se ignora.
  }
  return origen;
}

/** Primer toque de la pestaña: si ya hay uno guardado, no se pisa. */
export function capturarOrigenAlta(): void {
  try {
    if (window.sessionStorage.getItem(STORAGE_KEY)) return;
    const origen = origenDesdeNavegador(
      window.location.search,
      document.referrer,
      window.location.origin,
      window.location.pathname,
    );
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(origen));
  } catch {
    // Sin sessionStorage (modo privado estricto): no hay origen que guardar.
  }
}

/** Lo manda al servidor con tope de tiempo; cualquier fallo se traga. */
export async function enviarOrigenAlta(): Promise<void> {
  let body: string | null = null;
  try {
    body = window.sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return;
  }
  if (!body) return;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    await fetch("/api/saas/origen", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      signal: controller.signal,
    });
  } catch {
    // Un hipo del rastreo no es un fallo del alta.
  } finally {
    clearTimeout(timer);
  }
}

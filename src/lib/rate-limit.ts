/**
 * Limitación de tasa in-process por clave (IP) con ventana deslizante
 * (FR-062). Suficiente para el monolito de una instancia; sin Redis
 * (Constitución II).
 */

type Bucket = number[]; // timestamps (ms) de los intentos

const globalForRl = globalThis as unknown as {
  __voceroRateLimit?: Map<string, Bucket>;
};

function store(): Map<string, Bucket> {
  if (!globalForRl.__voceroRateLimit) {
    globalForRl.__voceroRateLimit = new Map();
  }
  return globalForRl.__voceroRateLimit;
}

export type RateLimitResult = { allowed: boolean; remaining: number };

export function checkRateLimit(
  key: string,
  opts: { windowMs: number; max: number },
  now: number = Date.now()
): RateLimitResult {
  const buckets = store();
  const cutoff = now - opts.windowMs;
  const bucket = (buckets.get(key) ?? []).filter((t) => t > cutoff);

  if (bucket.length >= opts.max) {
    buckets.set(key, bucket);
    return { allowed: false, remaining: 0 };
  }
  bucket.push(now);
  buckets.set(key, bucket);
  return { allowed: true, remaining: opts.max - bucket.length };
}

/**
 * La IP con la que se cuentan los intentos de una petición. Producción va
 * Cloudflare → Traefik y Traefik no confía en `X-Forwarded-For`, así que su
 * primera entrada suele ser una IP del borde de Cloudflare (todos los
 * visitantes de un borde compartirían tope): `CF-Connecting-IP` va primero y
 * lo demás queda como respaldo para quien corre sin Cloudflare.
 *
 * ponytail: `CF-Connecting-IP` solo es de fiar si todo el tráfico pasa por
 * Cloudflare; quien golpee el origen directo puede falsearla y saltarse el
 * tope por IP. El tope por correo del restablecimiento (3 por hora) sigue
 * aplicando. Si el origen queda expuesto, cerrar el firewall a los rangos de
 * Cloudflare o fijar `advanced.ipAddress.trustedProxies` en Better Auth.
 */
export const CLIENT_IP_HEADERS = ["cf-connecting-ip", "x-forwarded-for"] as const;

export function clientIp(headers: Pick<Headers, "get"> | undefined): string {
  return (
    headers?.get("cf-connecting-ip")?.trim() ||
    headers?.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    headers?.get("x-real-ip")?.trim() ||
    "local"
  );
}

/** Solo para tests. */
export function resetRateLimit(): void {
  store().clear();
}

/** 10 intentos / 10 minutos por IP en login y registro (FR-062). */
export const AUTH_RATE_LIMIT = { windowMs: 10 * 60 * 1000, max: 10 };

/** Cuántos intentos quedan sin gastar ninguno (lo usa la pantalla para deshabilitar un campo). */
export function peekRateLimit(
  key: string,
  opts: { windowMs: number; max: number },
  now: number = Date.now()
): number {
  const used = (store().get(key) ?? []).filter((t) => t > now - opts.windowMs).length;
  return Math.max(0, opts.max - used);
}

/** Devuelve el último intento de `key`: una llamada que falló por culpa nuestra no gasta cupo. */
export function refundRateLimit(key: string): void {
  const bucket = store().get(key);
  if (bucket?.length) bucket.pop();
}

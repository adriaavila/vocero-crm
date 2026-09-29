const DEFAULT_ROOT_DOMAIN = "allok.fun";
/**
 * Subdominios que NUNCA pueden ser un negocio.
 *
 * La raíz `allok.fun` reparte un subdominio por producto, y la cookie de sesión
 * se comparte en toda la raíz: si un negocio pudiera llamarse `agent` o
 * `inmox`, se quedaría con el hostname de otro producto. Van aquí todos los que
 * están en uso, no solo los de este repo.
 *
 * `ALLOK_RESERVED_SUBDOMAINS` (coma) suma más sin tocar código: Rei, por
 * ejemplo, reserva además `inmo,portal,smtp,dev,test` para reiprop.tech. `demo`
 * NO va acá a propósito: sigue disponible como slug de negocio.
 */
const RESERVED_SUBDOMAINS = new Set([
  "www",
  "app",
  "api",
  "admin",
  "status",
  "crm",
  "whatsapp",
  "preview",
  "staging",
  "agent",
  "inmox",
  "waha",
  "n8n",
  "coolify",
  "mail",
  "docs",
  "blog",
  "deploy-hooks",
  "medidor",
]);

function extraReservedSubdomains(): string[] {
  return (process.env.ALLOK_RESERVED_SUBDOMAINS ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * `ALLOK_ROOT_DOMAIN` limpio, tratando vacío/solo-espacios como no configurado.
 *
 * Gotcha real: `docker-compose.yml` pasa `ALLOK_ROOT_DOMAIN: ${ALLOK_ROOT_DOMAIN:-}`
 * (cadena vacía cuando no se define en el shell), y `??` solo cae al default
 * con `null`/`undefined` — una cadena vacía lo atraviesa tal cual y deja
 * `app.` o un dominio de cookie de un solo punto. Todo lo de este módulo (y
 * `lib/auth`) pasa por acá en vez de leer la variable de entorno directo.
 */
function envRootDomain(): string | undefined {
  const trimmed = process.env.ALLOK_ROOT_DOMAIN?.trim();
  if (!trimmed) return undefined;
  // "." (o cualquier cosa que se limpie a nada) tampoco es un dominio.
  return cleanRootDomain(trimmed) ? trimmed : undefined;
}

/** El dominio raíz configurado, ya limpio (sin puntos sueltos ni mayúsculas). */
export function resolvedRootDomain(): string {
  return cleanRootDomain(envRootDomain() ?? DEFAULT_ROOT_DOMAIN);
}

/** Admins de allok: `ALLOK_ADMIN_EMAILS`, separados por coma. */
export function isSaaSAdminEmail(email: string | null | undefined): boolean {
  const allowed = (process.env.ALLOK_ADMIN_EMAILS ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return Boolean(email && allowed.includes(email.trim().toLowerCase()));
}

export function isAllokSaaSMode(): boolean {
  return process.env.ALLOK_SAAS_MODE === "true";
}

/**
 * ¿Se ve como allok? Es la marca, no el modo: una instancia dedicada (la misma
 * imagen con `ALLOK_SAAS_MODE` apagado) también lleva el diseño allok, con el
 * nombre del negocio. `ALLOK_SAAS_MODE` sigue decidiendo lo que es del SaaS
 * (inquilinos por subdominio, cobro, registro).
 *
 * Encendida por defecto: todas las instalaciones son de allok. `ALLOK_BRAND=off`
 * deja la instancia con la marca Vocero de siempre, para quien la quiera así.
 */
export function isAllokBrand(): boolean {
  return isAllokSaaSMode() || process.env.ALLOK_BRAND !== "off";
}

export function isReservedSubdomain(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return RESERVED_SUBDOMAINS.has(normalized) || extraReservedSubdomains().includes(normalized);
}

/**
 * El hostname donde empieza el alta. Se usa en mensajes de error, así que sale
 * de la configuración y no de una constante: mover el producto de subdominio no
 * puede dejar a nadie leyendo una dirección que ya no existe.
 */
export function saasAppHost(
  rootDomain = envRootDomain() ?? DEFAULT_ROOT_DOMAIN,
): string {
  const configured = process.env.ALLOK_SAAS_APP_URL?.trim();
  if (configured) {
    try {
      return new URL(configured).hostname;
    } catch {
      return cleanHost(configured);
    }
  }
  return `app.${cleanRootDomain(rootDomain)}`;
}

function cleanHost(host: string): string {
  return host.trim().toLowerCase().replace(/\.$/, "").split(":")[0] ?? "";
}

function cleanRootDomain(rootDomain: string): string {
  return rootDomain.trim().toLowerCase().replace(/^\.+|\.+$/g, "");
}

export function isSaaSAppHost(
  host: string | null | undefined,
  rootDomain = envRootDomain() ?? DEFAULT_ROOT_DOMAIN,
): boolean {
  const normalizedHost = cleanHost(host ?? "");
  if (normalizedHost === "localhost" || normalizedHost === "app.localhost") return true;
  const configured = process.env.ALLOK_SAAS_APP_URL?.trim();
  if (configured) {
    try {
      return normalizedHost === cleanHost(new URL(configured).hostname);
    } catch {
      return false;
    }
  }
  return normalizedHost === `app.${cleanRootDomain(rootDomain)}`;
}

export function isSaaSAdminHost(
  host: string | null | undefined,
  rootDomain = envRootDomain() ?? DEFAULT_ROOT_DOMAIN,
): boolean {
  const normalizedHost = cleanHost(host ?? "");
  return normalizedHost === "admin.localhost" || normalizedHost === `admin.${cleanRootDomain(rootDomain)}`;
}

export function isLegacyAppHost(
  host: string | null | undefined,
  rootDomain = envRootDomain() ?? DEFAULT_ROOT_DOMAIN,
): boolean {
  const normalizedHost = cleanHost(host ?? "");
  if (!normalizedHost) return false;
  const configured = process.env.ALLOK_LEGACY_HOST?.trim();
  // Rei no tiene organización heredada: `ALLOK_LEGACY_HOST=none` apaga el
  // mapeo entero (sin esto, `crm.<root>` quedaría atado a un org legacy que
  // no existe en este despliegue).
  if (configured?.toLowerCase() === "none") return false;
  if (configured) {
    try {
      return normalizedHost === cleanHost(new URL(configured).hostname);
    } catch {
      return normalizedHost === cleanHost(configured);
    }
  }
  return normalizedHost === `crm.${cleanRootDomain(rootDomain)}` || normalizedHost === "crm.localhost";
}

export function isKnownAllokHost(
  host: string | null | undefined,
  rootDomain = envRootDomain() ?? DEFAULT_ROOT_DOMAIN,
): boolean {
  const normalizedHost = cleanHost(host ?? "");
  const normalizedRoot = cleanRootDomain(rootDomain);
  if (!normalizedHost || normalizedHost === "localhost" || normalizedHost === "127.0.0.1") return true;
  if (isLegacyAppHost(normalizedHost, normalizedRoot) || isSaaSAppHost(normalizedHost, normalizedRoot) || isSaaSAdminHost(normalizedHost, normalizedRoot)) return true;
  if (normalizedHost === normalizedRoot || normalizedHost === `www.${normalizedRoot}`) return true;
  if (normalizedHost.endsWith(".localhost")) {
    const prefix = normalizedHost.slice(0, -".localhost".length);
    return !prefix.includes(".") && (isReservedSubdomain(prefix) || Boolean(tenantSlugFromHost(normalizedHost, normalizedRoot)));
  }
  const suffix = `.${normalizedRoot}`;
  if (!normalizedHost.endsWith(suffix)) return false;
  const prefix = normalizedHost.slice(0, -suffix.length);
  return !prefix.includes(".") && (isReservedSubdomain(prefix) || Boolean(tenantSlugFromHost(normalizedHost, normalizedRoot)));
}

/**
 * Origen del navegador que Better Auth debe aceptar en el SaaS. Sin esto solo
 * `APP_BASE_URL` pasa el chequeo de origen y el login falla con
 * `INVALID_ORIGIN` en `<negocio>.<raíz>`, en el host de alta y en admin.
 * Solo hosts propios del despliegue: app, admin, legado y negocios; nunca la
 * raíz, `www` ni otros subdominios reservados.
 */
export function trustedSaaSOrigin(
  origin: string | null | undefined,
  rootDomain = process.env.ALLOK_ROOT_DOMAIN ?? DEFAULT_ROOT_DOMAIN,
): string | null {
  if (!origin) return null;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return null;
  }
  const host = cleanHost(url.hostname);
  const local = host === "localhost" || host.endsWith(".localhost");
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) return null;
  const known =
    isSaaSAppHost(host, rootDomain) ||
    isSaaSAdminHost(host, rootDomain) ||
    isLegacyAppHost(host, rootDomain) ||
    Boolean(tenantSlugFromHost(host, rootDomain));
  return known ? url.origin : null;
}

/**
 * The Origin to trust for one auth request: a known SaaS origin AND the same
 * host the request was sent to. Every real flow is same-origin (the auth client
 * has no baseURL), so a sibling subdomain this app doesn't serve, another port
 * or a loopback origin never passes.
 */
export function trustedOriginForRequest(
  origin: string | null | undefined,
  requestHost: string | null | undefined,
  rootDomain = process.env.ALLOK_ROOT_DOMAIN ?? DEFAULT_ROOT_DOMAIN,
): string | null {
  const trusted = trustedSaaSOrigin(origin, rootDomain);
  const host = requestHost?.split(",")[0]?.trim().toLowerCase().replace(/\.(?=:|$)/, "");
  if (!trusted || !host) return null;
  return new URL(trusted).host === host ? trusted : null;
}

export function tenantSlugFromHost(
  host: string | null | undefined,
  rootDomain = envRootDomain() ?? DEFAULT_ROOT_DOMAIN,
): string | null {
  if (!host) return null;
  const normalizedHost = cleanHost(host);
  const normalizedRoot = cleanRootDomain(rootDomain);
  if (!normalizedHost || !normalizedRoot) return null;

  if (isLegacyAppHost(normalizedHost, normalizedRoot)) return null;

  const localSuffix = ".localhost";
  if (normalizedHost.endsWith(localSuffix)) {
    const slug = normalizedHost.slice(0, -localSuffix.length);
    return !isReservedSubdomain(slug) && isTenantSlug(slug) ? slug : null;
  }

  const suffix = "." + normalizedRoot;
  if (!normalizedHost.endsWith(suffix)) return null;
  const prefix = normalizedHost.slice(0, -suffix.length);
  if (!prefix || prefix.includes(".")) return null;
  if (isReservedSubdomain(prefix)) return null;
  return isTenantSlug(prefix) ? prefix : null;
}

export function isTenantSlug(value: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$/.test(value);
}

export function slugifyTenantName(value: string): string {
  const normalized = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50)
    .replace(/-+$/, "");
  return isTenantSlug(normalized) && !isReservedSubdomain(normalized) ? normalized : "negocio";
}

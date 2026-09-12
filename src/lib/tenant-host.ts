const DEFAULT_ROOT_DOMAIN = "allok.fun";
/**
 * Subdominios que NUNCA pueden ser un negocio.
 *
 * La raíz `allok.fun` reparte un subdominio por producto, y la cookie de sesión
 * se comparte en toda la raíz: si un negocio pudiera llamarse `agent` o
 * `inmox`, se quedaría con el hostname de otro producto. Van aquí todos los que
 * están en uso, no solo los de este repo.
 */
const RESERVED_SUBDOMAINS = new Set([
  "www",
  "app",
  "api",
  "admin",
  "status",
  "crm",
  "whatsapp",
  "agent",
  "inmox",
  "waha",
  "n8n",
  "coolify",
  "mail",
  "docs",
  "blog",
]);

/**
 * Prefijo estable del aviso "regístrate en el host correcto". La pantalla de
 * registro lo reconoce por aquí para mostrarlo tal cual: el hostname cambia con
 * la configuración, la frase no. Vive en este módulo (puro, sin servidor) para
 * que el cliente pueda importarlo sin arrastrar la capa de autenticación.
 */
export const SIGNUP_HOST_HINT = "El registro de Allok empieza en";

export function isAllokSaaSMode(): boolean {
  return process.env.ALLOK_SAAS_MODE === "true";
}

export function isReservedSubdomain(value: string): boolean {
  return RESERVED_SUBDOMAINS.has(value.trim().toLowerCase());
}

/**
 * El hostname donde empieza el alta. Se usa en mensajes de error, así que sale
 * de la configuración y no de una constante: mover el producto de subdominio no
 * puede dejar a nadie leyendo una dirección que ya no existe.
 */
export function saasAppHost(
  rootDomain = process.env.ALLOK_ROOT_DOMAIN ?? DEFAULT_ROOT_DOMAIN,
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
  rootDomain = process.env.ALLOK_ROOT_DOMAIN ?? DEFAULT_ROOT_DOMAIN,
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
  rootDomain = process.env.ALLOK_ROOT_DOMAIN ?? DEFAULT_ROOT_DOMAIN,
): boolean {
  const normalizedHost = cleanHost(host ?? "");
  return normalizedHost === "admin.localhost" || normalizedHost === `admin.${cleanRootDomain(rootDomain)}`;
}

export function isLegacyAppHost(
  host: string | null | undefined,
  rootDomain = process.env.ALLOK_ROOT_DOMAIN ?? DEFAULT_ROOT_DOMAIN,
): boolean {
  const normalizedHost = cleanHost(host ?? "");
  if (!normalizedHost) return false;
  const configured = process.env.ALLOK_LEGACY_HOST?.trim();
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
  rootDomain = process.env.ALLOK_ROOT_DOMAIN ?? DEFAULT_ROOT_DOMAIN,
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

export function tenantSlugFromHost(
  host: string | null | undefined,
  rootDomain = process.env.ALLOK_ROOT_DOMAIN ?? DEFAULT_ROOT_DOMAIN,
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

/**
 * Catálogos cerrados del vertical inmobiliario (mercado LATAM, Bolivia primero).
 *
 * Son la única fuente de verdad de los valores permitidos: el esquema (los
 * mismos valores viven, literales, en los `enum` de `lib/db/schema.ts` — ese
 * archivo no importa nada para no crear un ciclo con el resto del dominio),
 * los validadores Zod, el motor de matching (`server/realty/matching.ts`) y la
 * UI se derivan de aquí. Ampliar un catálogo es una migración consciente, no
 * un string suelto en el código.
 *
 * Portado del fork inmobiliario (`vocero-inmobiliario-main`), spec 003.
 */

/**
 * `anticretico`: el dueño recibe una suma, el ocupante vive sin pagar alquiler
 * y recupera su dinero al terminar. En Bolivia es una tercera operación tan
 * común como el alquiler, no una forma de pago.
 */
export const OPERATIONS = ["renta", "venta", "anticretico"] as const;
export type Operation = (typeof OPERATIONS)[number];

export const PROPERTY_KINDS = [
  "casa",
  "departamento",
  "local",
  "terreno",
  "oficina",
  "bodega",
] as const;
export type PropertyKind = (typeof PROPERTY_KINDS)[number];

export const CURRENCIES = ["USD", "BOB", "MXN"] as const;
export type Currency = (typeof CURRENCIES)[number];

/**
 * En casi toda LATAM el inmueble se cotiza en dólares aunque se pague en
 * moneda local, y en Bolivia eso es la norma. El default vive aquí y en
 * ningún otro lado (y en el default de columna de `schema.ts`, que lo repite
 * como literal a propósito: ver la nota de ese archivo).
 */
export const DEFAULT_CURRENCY: Currency = "USD";

/** Locale del formateo de precios: separador de miles con punto (es-BO). */
const PRICE_LOCALE = "es-BO";

/** Eje A: estatus COMERCIAL. Ortogonal al archivado (eje B, ver properties.ts). */
export const PROPERTY_STATUSES = ["disponible", "apartada", "cerrada"] as const;
export type PropertyStatus = (typeof PROPERTY_STATUSES)[number];

export const AMENITIES = [
  "estacionamiento",
  "alberca",
  "jardin",
  "roof_garden",
  "seguridad",
  "elevador",
  "gimnasio",
  "amueblado",
  "acepta_mascotas",
  "bodega",
  "terraza",
  "cocina_integral",
  "aire_acondicionado",
  "cisterna",
] as const;
export type Amenity = (typeof AMENITIES)[number];

/**
 * Forma de pago. Decide si un prospecto es viable: un comprador de contado y
 * uno con crédito de vivienda social no compiten por el mismo inventario.
 */
export const PAYMENT_METHODS = [
  "contado",
  "credito_bancario",
  "credito_vis",
  "otro",
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const URGENCIES = ["alta", "media", "baja"] as const;
export type Urgency = (typeof URGENCIES)[number];

/**
 * Desenlace de una visita (`booking_property.outcome`). Nace del `viewing`
 * del fork inmobiliario; aquí la visita ES una `booking` de allok con esta
 * fila lateral, así que solo el desenlace comercial vive acá (el estatus de
 * la cita en sí — agendada/realizada/cancelada — ya lo tiene `booking`).
 */
export const BOOKING_OUTCOMES = [
  "interesado",
  "no_interesado",
  "quiere_negociar",
  "sin_definir",
] as const;
export type BookingOutcome = (typeof BOOKING_OUTCOMES)[number];

/* ============================================================
 * Etiquetas en español (UI y mensajes de WhatsApp)
 * ============================================================ */

export const OPERATION_LABELS: Record<Operation, string> = {
  // "Alquiler" y no "Renta": es lo que se dice de Bolivia a Argentina.
  renta: "Alquiler",
  venta: "Venta",
  anticretico: "Anticrético",
};

export const PROPERTY_KIND_LABELS: Record<PropertyKind, string> = {
  casa: "Casa",
  departamento: "Departamento",
  local: "Local",
  terreno: "Terreno",
  oficina: "Oficina",
  bodega: "Bodega",
};

export const PROPERTY_STATUS_LABELS: Record<PropertyStatus, string> = {
  disponible: "Disponible",
  // Hay anticipo, ya no se oferta, pero todavía no cerró.
  apartada: "Reservada",
  cerrada: "Cerrada",
};

export const AMENITY_LABELS: Record<Amenity, string> = {
  estacionamiento: "Estacionamiento",
  alberca: "Piscina",
  jardin: "Jardín",
  roof_garden: "Roof garden",
  seguridad: "Seguridad",
  elevador: "Elevador",
  gimnasio: "Gimnasio",
  amueblado: "Amueblado",
  acepta_mascotas: "Acepta mascotas",
  bodega: "Bodega",
  terraza: "Terraza",
  cocina_integral: "Cocina integral",
  aire_acondicionado: "Aire acondicionado",
  cisterna: "Cisterna",
};

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  contado: "Contado",
  credito_bancario: "Crédito bancario",
  credito_vis: "Crédito de vivienda social",
  otro: "Otro",
};

export const URGENCY_LABELS: Record<Urgency, string> = {
  alta: "Alta",
  media: "Media",
  baja: "Baja",
};

export const BOOKING_OUTCOME_LABELS: Record<BookingOutcome, string> = {
  interesado: "Interesado",
  no_interesado: "No le interesó",
  quiere_negociar: "Quiere negociar",
  sin_definir: "Sin definir",
};

/* ============================================================
 * Formateo del dominio
 * ============================================================ */

/**
 * Precio: miles SIN decimales. `Bs` es como se dice un monto en bolivianos en
 * el habla real (nunca "$... BOB"); el resto lleva `$` + el código UNA sola
 * vez, impreso siempre aquí y en ningún otro lado.
 */
export function formatPrice(
  price: number | string | null | undefined,
  currency: Currency | string | null | undefined
): string {
  const value = typeof price === "string" ? Number(price) : price;
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }
  const code = isCurrency(currency) ? currency : DEFAULT_CURRENCY;
  const amount = new Intl.NumberFormat(PRICE_LOCALE, {
    maximumFractionDigits: 0,
  }).format(Math.round(value));
  return code === "BOB" ? `Bs ${amount}` : `$${amount} ${code}`;
}

/** Zona = `colonia, ciudad`; con una sola, esa; sin ninguna, `—`. */
export function formatZone(
  neighborhood: string | null | undefined,
  city: string | null | undefined
): string {
  const parts = [neighborhood?.trim(), city?.trim()].filter(
    (p): p is string => !!p
  );
  return parts.length > 0 ? parts.join(", ") : "—";
}

/**
 * Specs compactas: `3 dorm · 2.5 baños · 180 m²`. Cada parte se omite si falta;
 * sin ninguna devuelve cadena vacía (quien la use decide si omite la línea).
 */
export function formatSpecs(input: {
  bedrooms?: number | string | null;
  bathrooms?: number | string | null;
  builtArea?: number | string | null;
}): string {
  const num = (v: number | string | null | undefined): number | null => {
    if (v === null || v === undefined || v === "") return null;
    const n = typeof v === "string" ? Number(v) : v;
    return Number.isFinite(n) ? n : null;
  };
  const parts: string[] = [];
  const bedrooms = num(input.bedrooms);
  const bathrooms = num(input.bathrooms);
  const area = num(input.builtArea);
  if (bedrooms !== null) parts.push(`${trimDecimals(bedrooms)} dorm`);
  if (bathrooms !== null) parts.push(`${trimDecimals(bathrooms)} baños`);
  if (area !== null) parts.push(`${trimDecimals(area)} m²`);
  return parts.join(" · ");
}

/** `2.0` → `2`, `1.5` → `1.5` (los medios baños son reales en el mercado). */
function trimDecimals(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(1)));
}

/** Título derivado cuando el asesor no capturó uno: nunca queda vacío. */
export function derivedTitle(
  kind: PropertyKind | string,
  city: string | null | undefined
): string {
  const kindLabel = isPropertyKind(kind) ? PROPERTY_KIND_LABELS[kind] : "Inmueble";
  const cityName = city?.trim();
  return cityName ? `${kindLabel} en ${cityName}` : kindLabel;
}

/**
 * Normaliza texto para comparar zonas: minúsculas y sin acentos, de modo que
 * "Anzures" empate con "anzures" y "Coyoacán" con "coyoacan".
 */
export function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * Zonas del requerimiento, normalizadas a un array.
 *
 * `requirement.zones` se guarda como `jsonb` (array) — así lo espera el
 * contrato de Nea (`zones: string[]`, parte 2, `/api/bot/realty/*`) — pero
 * esta función también acepta una cadena separada por coma o diagonal
 * ("Del Valle, Narvarte") para quien todavía escribe zonas como texto libre
 * (un formulario, o estos mismos tests). Cualquiera de las dos formas
 * termina en la misma lista limpia.
 */
export function parseZones(
  zones: readonly string[] | string | null | undefined
): string[] {
  if (!zones) return [];
  const raw: readonly string[] = Array.isArray(zones)
    ? zones
    : (zones as string).split(/[,/]/);
  return raw.map((z) => z.trim()).filter((z) => z.length > 0);
}

/* ============================================================
 * Guards
 * ============================================================ */

export function isOperation(v: unknown): v is Operation {
  return typeof v === "string" && (OPERATIONS as readonly string[]).includes(v);
}

export function isPropertyKind(v: unknown): v is PropertyKind {
  return (
    typeof v === "string" && (PROPERTY_KINDS as readonly string[]).includes(v)
  );
}

export function isCurrency(v: unknown): v is Currency {
  return typeof v === "string" && (CURRENCIES as readonly string[]).includes(v);
}

export function isAmenity(v: unknown): v is Amenity {
  return typeof v === "string" && (AMENITIES as readonly string[]).includes(v);
}

export function isPaymentMethod(v: unknown): v is PaymentMethod {
  return (
    typeof v === "string" && (PAYMENT_METHODS as readonly string[]).includes(v)
  );
}

/** Filtra un jsonb crudo de la BD a un array del catálogo (defensivo). */
export function toAmenities(value: unknown): Amenity[] {
  return Array.isArray(value) ? value.filter(isAmenity) : [];
}

export function toPaymentMethods(value: unknown): PaymentMethod[] {
  return Array.isArray(value) ? value.filter(isPaymentMethod) : [];
}

import {
  AMENITY_LABELS,
  DEFAULT_CURRENCY,
  PAYMENT_METHOD_LABELS,
  PROPERTY_KIND_LABELS,
  formatZone,
  normalizeText,
  parseZones,
  toAmenities,
  toPaymentMethods,
  type Amenity,
  type Currency,
  type Operation,
  type PaymentMethod,
  type PropertyKind,
} from "@/lib/realty/catalog";

/**
 * Motor de matching determinista (parte 2 lo consume; vive aquí desde la
 * parte 1 porque es puro y no depende de nada del resto del vertical).
 *
 * `scoreProperty` es PURA: no toca la base de datos ni el reloj. Eso la hace
 * testeable sin Postgres y —más importante— hace que el número que ve el
 * asesor sea auditable y reproducible. La capa de IA (parte 2) solo añade una
 * frase explicativa encima; jamás reordena ni sobrescribe este score.
 *
 * Regla del score: cada criterio DECLARADO por el lead vale 1 punto; el
 * resultado es `puntos / criterios aplicables × 100`. Un criterio que el lead
 * dejó vacío no entra al denominador — no penaliza.
 *
 * Portado sin cambios de lógica del fork inmobiliario
 * (`vocero-inmobiliario-main`, spec 003).
 */

export const MATCH_CRITERIA = [
  "presupuesto",
  "zona",
  "tipo",
  "recamaras",
  "banos",
  "amenidades",
  "pago",
] as const;

export type MatchCriterion = (typeof MATCH_CRITERIA)[number];

/** `full` = 1 punto · `partial` = 0.5 · `none` = 0. */
export type MatchFit = "full" | "partial" | "none";

export type MatchReason = {
  criterion: MatchCriterion;
  fit: MatchFit;
  /** Texto del chip, ya listo para pintar (sin el ✓/✗, que lo pone la UI). */
  label: string;
};

export type MatchScore = {
  score: number;
  reasons: MatchReason[];
};

/** Forma mínima del requerimiento que necesita el motor. */
export type RequirementInput = {
  operation?: Operation | null;
  budgetMin?: number | string | null;
  budgetMax?: number | string | null;
  currency?: Currency | string | null;
  /** Acepta el array del contrato de Nea o una cadena "Del Valle, Narvarte" (`parseZones`). */
  zones?: readonly string[] | string | null;
  kind?: PropertyKind | null;
  minBedrooms?: number | null;
  minBathrooms?: number | string | null;
  amenities?: unknown;
  paymentMethod?: PaymentMethod | null;
};

/** Forma mínima de la propiedad que necesita el motor. */
export type PropertyInput = {
  id: string;
  operation: Operation | string;
  kind: PropertyKind | string;
  price: number | string;
  currency?: Currency | string | null;
  neighborhood?: string | null;
  city?: string | null;
  bedrooms?: number | null;
  bathrooms?: number | string | null;
  amenities?: unknown;
  acceptedPayments?: unknown;
  status?: string | null;
  archivedAt?: Date | null;
};

const BUDGET_TOLERANCE = 0.15;

/** Convierte los `numeric` de Postgres (que llegan como string) a número. */
function num(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "string" ? Number(value) : value;
  return Number.isFinite(n) ? n : null;
}

const POINTS: Record<MatchFit, number> = { full: 1, partial: 0.5, none: 0 };

/**
 * Puntúa UNA propiedad contra UN requerimiento.
 *
 * Sin ningún criterio declarado devuelve 50 — neutral. Ni 0 (que diría "no te
 * sirve" sin base) ni 100 (que diría "es perfecta" sin base).
 */
export function scoreProperty(
  requirement: RequirementInput,
  property: PropertyInput
): MatchScore {
  const reasons: MatchReason[] = [];

  const budget = scoreBudget(requirement, property);
  if (budget) reasons.push(budget);

  const zone = scoreZone(requirement, property);
  if (zone) reasons.push(zone);

  const kind = scoreKind(requirement, property);
  if (kind) reasons.push(kind);

  const bedrooms = scoreBedrooms(requirement, property);
  if (bedrooms) reasons.push(bedrooms);

  const bathrooms = scoreBathrooms(requirement, property);
  if (bathrooms) reasons.push(bathrooms);

  const amenities = scoreAmenities(requirement, property);
  if (amenities) reasons.push(amenities);

  const payment = scorePayment(requirement, property);
  if (payment) reasons.push(payment);

  if (reasons.length === 0) return { score: 50, reasons };

  const earned = reasons.reduce((sum, r) => sum + POINTS[r.fit], 0);
  return {
    score: Math.round((earned / reasons.length) * 100),
    reasons,
  };
}

/**
 * Presupuesto: dentro del rango = 1, dentro de ±15 % = 0.5, fuera = 0.
 *
 * Es la ÚNICA relajación gradual del sistema. Si las monedas no coinciden el
 * criterio no aplica: comparar pesos contra dólares sin tipo de cambio daría
 * un número inventado, y este motor no inventa (se excluye del denominador,
 * así el chip y el score siguen contando la misma historia).
 */
function scoreBudget(
  req: RequirementInput,
  prop: PropertyInput
): MatchReason | null {
  const min = num(req.budgetMin);
  const max = num(req.budgetMax);
  if (min === null && max === null) return null;

  const reqCurrency = req.currency ?? DEFAULT_CURRENCY;
  const propCurrency = prop.currency ?? DEFAULT_CURRENCY;
  if (reqCurrency !== propCurrency) return null;

  const price = num(prop.price);
  if (price === null) return null;

  const lower = min ?? 0;
  const upper = max ?? Number.POSITIVE_INFINITY;
  if (price >= lower && price <= upper) {
    return {
      criterion: "presupuesto",
      fit: "full",
      label: "Dentro de presupuesto",
    };
  }

  const softLower = lower * (1 - BUDGET_TOLERANCE);
  const softUpper =
    upper === Number.POSITIVE_INFINITY
      ? Number.POSITIVE_INFINITY
      : upper * (1 + BUDGET_TOLERANCE);
  if (price >= softLower && price <= softUpper) {
    return {
      criterion: "presupuesto",
      fit: "partial",
      label: "Cerca del presupuesto",
    };
  }

  return {
    criterion: "presupuesto",
    fit: "none",
    label: "Fuera de presupuesto",
  };
}

/**
 * Zona: basta que UNA de las zonas del lead aparezca en `colonia + ciudad`.
 * Comparación sin acentos ni mayúsculas, por substring — "anzures" empata con
 * "Anzures" y "coyoacan" con "Coyoacán".
 */
function scoreZone(
  req: RequirementInput,
  prop: PropertyInput
): MatchReason | null {
  const zones = parseZones(req.zones);
  if (zones.length === 0) return null;

  const haystack = normalizeText(
    [prop.neighborhood ?? "", prop.city ?? ""].join(" ")
  );
  const hit = zones.some((z) => {
    const needle = normalizeText(z);
    return needle.length > 0 && haystack.includes(needle);
  });

  // El chip muestra la zona DE LA PROPIEDAD: es lo que el asesor necesita ver.
  return {
    criterion: "zona",
    fit: hit ? "full" : "none",
    label: `Zona: ${formatZone(prop.neighborhood, prop.city)}`,
  };
}

function scoreKind(
  req: RequirementInput,
  prop: PropertyInput
): MatchReason | null {
  if (!req.kind) return null;
  const label =
    PROPERTY_KIND_LABELS[prop.kind as PropertyKind] ?? String(prop.kind);
  return {
    criterion: "tipo",
    fit: prop.kind === req.kind ? "full" : "none",
    label,
  };
}

/**
 * Dormitorios: la propiedad cumple con MÁS de las pedidas, no solo con las
 * exactas. Una menos es "casi" (0.5): en el mercado real un 2 dormitorios se
 * enseña a quien pidió 3 si todo lo demás encaja.
 */
function scoreBedrooms(
  req: RequirementInput,
  prop: PropertyInput
): MatchReason | null {
  const min = req.minBedrooms;
  if (min === null || min === undefined) return null;
  const label = `${min}+ dormitorios`;
  const actual = prop.bedrooms;
  if (actual === null || actual === undefined) {
    return { criterion: "recamaras", fit: "none", label };
  }
  if (actual >= min) return { criterion: "recamaras", fit: "full", label };
  if (actual === min - 1) {
    return { criterion: "recamaras", fit: "partial", label };
  }
  return { criterion: "recamaras", fit: "none", label };
}

function scoreBathrooms(
  req: RequirementInput,
  prop: PropertyInput
): MatchReason | null {
  const min = num(req.minBathrooms);
  if (min === null) return null;
  const label = `${min}+ baños`;
  const actual = num(prop.bathrooms);
  if (actual === null) {
    return { criterion: "banos", fit: "none", label };
  }
  return {
    criterion: "banos",
    fit: actual >= min ? "full" : "none",
    label,
  };
}

/** Amenidades: todas = 1, al menos la mitad = 0.5, ninguna = 0. */
function scoreAmenities(
  req: RequirementInput,
  prop: PropertyInput
): MatchReason | null {
  const wanted = toAmenities(req.amenities);
  if (wanted.length === 0) return null;

  const has = new Set<Amenity>(toAmenities(prop.amenities));
  const present = wanted.filter((a) => has.has(a));

  if (present.length === wanted.length) {
    return {
      criterion: "amenidades",
      fit: "full",
      label: wanted.map((a) => AMENITY_LABELS[a]).join(", "),
    };
  }
  if (present.length * 2 >= wanted.length) {
    return {
      criterion: "amenidades",
      fit: "partial",
      label: `${present.length} de ${wanted.length} amenidades`,
    };
  }
  return {
    criterion: "amenidades",
    fit: "none",
    label: wanted.map((a) => AMENITY_LABELS[a]).join(", "),
  };
}

/**
 * Forma de pago. Decide la viabilidad: un comprador con crédito social no
 * puede comprar una propiedad que no acepta ese esquema.
 *
 * Si la propiedad no declara formas de pago, el criterio NO aplica: no hay
 * información, y castigar por un dato que el asesor aún no capturó escondería
 * inventario válido.
 */
function scorePayment(
  req: RequirementInput,
  prop: PropertyInput
): MatchReason | null {
  const wanted = req.paymentMethod;
  if (!wanted) return null;

  const accepted = toPaymentMethods(prop.acceptedPayments);
  if (accepted.length === 0) return null;

  const label = PAYMENT_METHOD_LABELS[wanted];
  return {
    criterion: "pago",
    fit: accepted.includes(wanted) ? "full" : "none",
    label: accepted.includes(wanted) ? `Acepta ${label}` : `No acepta ${label}`,
  };
}

/**
 * Prefiltro duro: elimina candidatas, no les resta puntos.
 *
 * Se aplica IGUAL en las dos direcciones (lead→propiedades y
 * propiedad→leads, parte 2). El filtro de estatus corre en las dos: el panel
 * inverso no debe ofrecer leads para propiedades ya apartadas o cerradas.
 */
export function isEligibleProperty(
  requirement: Pick<RequirementInput, "operation">,
  property: PropertyInput
): boolean {
  if (property.archivedAt) return false;
  if (property.status !== "disponible") return false;
  if (requirement.operation && property.operation !== requirement.operation) {
    return false;
  }
  return true;
}

/**
 * Orden del ranking con desempate DETERMINISTA: score desc, luego precio asc,
 * luego id. Sin la segunda y tercera llave, dos propiedades con el mismo score
 * podían intercambiarse entre recargas y el asesor veía un orden distinto cada
 * vez sin que nada hubiera cambiado.
 */
export function compareMatches(
  a: { score: number; property: Pick<PropertyInput, "id" | "price"> },
  b: { score: number; property: Pick<PropertyInput, "id" | "price"> }
): number {
  if (a.score !== b.score) return b.score - a.score;
  const priceA = num(a.property.price) ?? Number.POSITIVE_INFINITY;
  const priceB = num(b.property.price) ?? Number.POSITIVE_INFINITY;
  if (priceA !== priceB) return priceA - priceB;
  return a.property.id.localeCompare(b.property.id);
}

/**
 * Puntúa y ordena un conjunto ya prefiltrado (parte 2).
 *
 * Genérica sobre la propiedad para no perder los campos de la fila completa:
 * quien pasa un `PropertyRow` recupera un `PropertyRow`, no el subconjunto que
 * necesita el motor.
 */
export function rankProperties<P extends PropertyInput>(
  requirement: RequirementInput,
  properties: P[],
  limit?: number
): { property: P; score: number; reasons: MatchReason[] }[] {
  const ranked = properties
    .filter((p) => isEligibleProperty(requirement, p))
    .map((property) => {
      const { score, reasons } = scoreProperty(requirement, property);
      return { property, score, reasons };
    })
    .sort(compareMatches);
  return limit === undefined ? ranked : ranked.slice(0, limit);
}

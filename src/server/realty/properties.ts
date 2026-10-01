import {
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lte,
  or,
  sql,
} from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import {
  AMENITIES,
  CURRENCIES,
  DEFAULT_CURRENCY,
  OPERATIONS,
  PAYMENT_METHODS,
  PROPERTY_KINDS,
  PROPERTY_STATUSES,
  derivedTitle,
  formatSpecs,
  formatZone,
} from "@/lib/realty/catalog";

/**
 * Catálogo de propiedades (vertical inmobiliario, parte 1).
 *
 * Dos ejes ORTOGONALES que no deben confundirse:
 *   · `status`     — estatus COMERCIAL (disponible / apartada / cerrada).
 *   · `archivedAt` — visibilidad (soft-delete reversible).
 * Archivar no toca el estatus, y desarchivar lo devuelve tal como estaba. Por
 * eso "archivada" NO es un valor del enum de estatus. No hay borrado duro.
 *
 * Portado y adaptado del fork inmobiliario (`vocero-inmobiliario-main`,
 * spec 003) a `withAuth`/`parseBody`/`scoped()` de este repo.
 */

export class PropertyError extends Error {
  code: "not_found" | "invalid";
  constructor(code: PropertyError["code"], message: string) {
    super(message);
    this.name = "PropertyError";
    this.code = code;
  }
}

const decimalString = z
  .union([z.number(), z.string()])
  .transform((v) => String(v))
  .refine((v) => v === "" || Number.isFinite(Number(v)), "Debe ser un número");

export const PropertyInputSchema = z.object({
  operation: z.enum(OPERATIONS),
  kind: z.enum(PROPERTY_KINDS),
  title: z.string().trim().max(200).optional().nullable(),
  // El precio es el ÚNICO campo obligatorio además de operación y tipo.
  // `z.coerce.number()` (no `.union([z.number(),z.string()]).transform(...)`,
  // como en el fork original): un ZodEffects aquí hacía que `.partial()`
  // (`PropertyPatchSchema` abajo) perdiera el tipo de salida y `price`
  // quedara como `string | number` en vez de `number`.
  price: z.coerce
    .number()
    .refine((v) => Number.isFinite(v) && v > 0, "El precio debe ser mayor que 0"),
  currency: z.enum(CURRENCIES).default(DEFAULT_CURRENCY),
  address: z.string().trim().max(300).optional().nullable(),
  neighborhood: z.string().trim().max(160).optional().nullable(),
  city: z.string().trim().max(160).optional().nullable(),
  bedrooms: z.number().int().min(0).optional().nullable(),
  bathrooms: decimalString.optional().nullable(),
  builtArea: decimalString.optional().nullable(),
  lotArea: decimalString.optional().nullable(),
  parking: z.number().int().min(0).optional().nullable(),
  amenities: z.array(z.enum(AMENITIES)).default([]),
  acceptedPayments: z.array(z.enum(PAYMENT_METHODS)).default([]),
  status: z.enum(PROPERTY_STATUSES).default("disponible"),
  description: z.string().trim().max(4000).optional().nullable(),
});

/**
 * Edición PARCIAL: solo los campos enviados cambian.
 *
 * NO se deriva con `PropertyInputSchema.partial()`: en esta versión de zod,
 * `.partial()` sobre un shape con `ZodEffects` (los `decimalString` de
 * abajo) pierde el tipo de SALIDA del transform y `z.infer<>` termina viendo
 * `string | number` en vez de `string` — cada campo se redefine aquí con su
 * propio `.optional()`, que sí preserva el tipo correctamente.
 */
export const PropertyPatchSchema = z.object({
  operation: z.enum(OPERATIONS).optional(),
  kind: z.enum(PROPERTY_KINDS).optional(),
  title: z.string().trim().max(200).nullable().optional(),
  price: z.coerce
    .number()
    .refine((v) => Number.isFinite(v) && v > 0, "El precio debe ser mayor que 0")
    .optional(),
  currency: z.enum(CURRENCIES).optional(),
  address: z.string().trim().max(300).nullable().optional(),
  neighborhood: z.string().trim().max(160).nullable().optional(),
  city: z.string().trim().max(160).nullable().optional(),
  bedrooms: z.number().int().min(0).nullable().optional(),
  bathrooms: decimalString.nullable().optional(),
  builtArea: decimalString.nullable().optional(),
  lotArea: decimalString.nullable().optional(),
  parking: z.number().int().min(0).nullable().optional(),
  amenities: z.array(z.enum(AMENITIES)).optional(),
  acceptedPayments: z.array(z.enum(PAYMENT_METHODS)).optional(),
  status: z.enum(PROPERTY_STATUSES).optional(),
  description: z.string().trim().max(4000).nullable().optional(),
});

export type PropertyRow = typeof schema.property.$inferSelect;

/**
 * Versión del inventario por organización. Cualquier escritura la incrementa,
 * y eso invalida la caché de matches de TODOS los leads sin recorrerlos
 * (parte 2): una propiedad nueva aparece de inmediato en los paneles.
 */
export async function bumpCatalogVersion(
  organizationId: string
): Promise<number> {
  const db = getDb();
  const rows = await db
    .insert(schema.orgCatalogVersion)
    .values({ organizationId, version: 1 })
    .onConflictDoUpdate({
      target: schema.orgCatalogVersion.organizationId,
      set: {
        version: sql`${schema.orgCatalogVersion.version} + 1`,
        updatedAt: new Date(),
      },
    })
    .returning({ version: schema.orgCatalogVersion.version });
  return rows[0]?.version ?? 0;
}

export async function getCatalogVersion(
  organizationId: string
): Promise<number> {
  const db = getDb();
  const rows = await db
    .select({ version: schema.orgCatalogVersion.version })
    .from(schema.orgCatalogVersion)
    .where(eq(schema.orgCatalogVersion.organizationId, organizationId))
    .limit(1);
  return rows[0]?.version ?? 0;
}

export type ListFilters = {
  search?: string;
  operation?: string;
  kind?: string;
  status?: string;
  archived?: boolean;
  priceMin?: number;
  priceMax?: number;
  page?: number;
  pageSize?: number;
};

const MAX_PAGE_SIZE = 100;

/** Listado con buscador, filtros y paginación REAL (nunca truncado en silencio). */
export async function listProperties(
  organizationId: string,
  filters: ListFilters = {}
): Promise<{
  properties: PropertyRow[];
  total: number;
  page: number;
  pageSize: number;
}> {
  const db = getDb();
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, filters.pageSize ?? 24));

  const conditions = [
    filters.archived
      ? isNotNull(schema.property.archivedAt)
      : isNull(schema.property.archivedAt),
  ];

  if (filters.search?.trim()) {
    const needle = `%${filters.search.trim()}%`;
    const match = or(
      ilike(schema.property.title, needle),
      ilike(schema.property.neighborhood, needle),
      ilike(schema.property.city, needle),
      ilike(schema.property.address, needle)
    );
    if (match) conditions.push(match);
  }
  if (filters.operation) {
    conditions.push(eq(schema.property.operation, filters.operation as never));
  }
  if (filters.kind) {
    conditions.push(eq(schema.property.kind, filters.kind as never));
  }
  if (filters.status) {
    conditions.push(eq(schema.property.status, filters.status as never));
  }
  if (filters.priceMin !== undefined) {
    conditions.push(gte(schema.property.price, String(filters.priceMin)));
  }
  if (filters.priceMax !== undefined) {
    conditions.push(lte(schema.property.price, String(filters.priceMax)));
  }

  const where = scoped(
    schema.property.organizationId,
    organizationId,
    ...conditions
  );

  const [rows, totals] = await Promise.all([
    db
      .select()
      .from(schema.property)
      .where(where)
      .orderBy(desc(schema.property.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ value: count() }).from(schema.property).where(where),
  ]);

  return {
    properties: rows,
    total: totals[0]?.value ?? 0,
    page,
    pageSize,
  };
}

/** Una propiedad de OTRA organización responde 404, nunca 403. */
export async function getProperty(
  organizationId: string,
  propertyId: string
): Promise<PropertyRow | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.property)
    .where(
      scoped(
        schema.property.organizationId,
        organizationId,
        eq(schema.property.id, propertyId)
      )
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function createProperty(
  organizationId: string,
  input: z.infer<typeof PropertyInputSchema>,
  createdBy: string | null
): Promise<PropertyRow> {
  const db = getDb();
  const inserted = await db
    .insert(schema.property)
    .values({
      id: newId("property"),
      organizationId,
      operation: input.operation,
      kind: input.kind,
      title: input.title?.trim() || null,
      price: String(input.price),
      currency: input.currency,
      address: input.address ?? null,
      neighborhood: input.neighborhood ?? null,
      city: input.city ?? null,
      bedrooms: input.bedrooms ?? null,
      bathrooms: input.bathrooms ?? null,
      builtArea: input.builtArea ?? null,
      lotArea: input.lotArea ?? null,
      parking: input.parking ?? null,
      amenities: input.amenities,
      acceptedPayments: input.acceptedPayments,
      status: input.status,
      description: input.description ?? null,
      createdBy,
    })
    .returning();
  await bumpCatalogVersion(organizationId);
  return inserted[0]!;
}

export async function updateProperty(
  organizationId: string,
  propertyId: string,
  patch: z.infer<typeof PropertyPatchSchema>
): Promise<PropertyRow> {
  const existing = await getProperty(organizationId, propertyId);
  if (!existing) throw new PropertyError("not_found", "Propiedad no encontrada");

  const values: Partial<typeof schema.property.$inferInsert> = {
    updatedAt: new Date(),
  };
  // Solo se tocan los campos presentes en el patch (edición parcial).
  if (patch.operation !== undefined) values.operation = patch.operation;
  if (patch.kind !== undefined) values.kind = patch.kind;
  if (patch.title !== undefined) values.title = patch.title?.trim() || null;
  if (patch.price !== undefined) values.price = String(patch.price);
  if (patch.currency !== undefined) values.currency = patch.currency;
  if (patch.address !== undefined) values.address = patch.address ?? null;
  if (patch.neighborhood !== undefined) {
    values.neighborhood = patch.neighborhood ?? null;
  }
  if (patch.city !== undefined) values.city = patch.city ?? null;
  if (patch.bedrooms !== undefined) values.bedrooms = patch.bedrooms ?? null;
  if (patch.bathrooms !== undefined) values.bathrooms = patch.bathrooms ?? null;
  if (patch.builtArea !== undefined) values.builtArea = patch.builtArea ?? null;
  if (patch.lotArea !== undefined) values.lotArea = patch.lotArea ?? null;
  if (patch.parking !== undefined) values.parking = patch.parking ?? null;
  if (patch.amenities !== undefined) values.amenities = patch.amenities;
  if (patch.acceptedPayments !== undefined) {
    values.acceptedPayments = patch.acceptedPayments;
  }
  if (patch.status !== undefined) values.status = patch.status;
  if (patch.description !== undefined) {
    values.description = patch.description ?? null;
  }

  const updated = await getDb()
    .update(schema.property)
    .set(values)
    .where(
      scoped(
        schema.property.organizationId,
        organizationId,
        eq(schema.property.id, propertyId)
      )
    )
    .returning();
  await bumpCatalogVersion(organizationId);
  return updated[0]!;
}

/**
 * Archivar / desarchivar. NO toca `status`: al desarchivar, la propiedad
 * vuelve exactamente con el estatus comercial que tenía.
 */
export async function setArchived(
  organizationId: string,
  propertyId: string,
  archived: boolean
): Promise<PropertyRow> {
  const existing = await getProperty(organizationId, propertyId);
  if (!existing) throw new PropertyError("not_found", "Propiedad no encontrada");

  const updated = await getDb()
    .update(schema.property)
    .set({ archivedAt: archived ? new Date() : null, updatedAt: new Date() })
    .where(
      scoped(
        schema.property.organizationId,
        organizationId,
        eq(schema.property.id, propertyId)
      )
    )
    .returning();
  await bumpCatalogVersion(organizationId);
  return updated[0]!;
}

/** Serialización para la API: añade los derivados que la UI usa. */
export function serializeProperty(
  row: PropertyRow,
  extra: { photoCount?: number; coverPhotoUrl?: string | null } = {}
) {
  return {
    id: row.id,
    operation: row.operation,
    kind: row.kind,
    title: row.title ?? derivedTitle(row.kind, row.city),
    hasCustomTitle: !!row.title,
    price: row.price,
    currency: row.currency,
    address: row.address,
    neighborhood: row.neighborhood,
    city: row.city,
    zone: formatZone(row.neighborhood, row.city),
    bedrooms: row.bedrooms,
    bathrooms: row.bathrooms,
    builtArea: row.builtArea,
    lotArea: row.lotArea,
    parking: row.parking,
    specs: formatSpecs({
      bedrooms: row.bedrooms,
      bathrooms: row.bathrooms,
      builtArea: row.builtArea,
    }),
    amenities: row.amenities,
    acceptedPayments: row.acceptedPayments,
    status: row.status,
    description: row.description,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    photoCount: extra.photoCount ?? 0,
    coverPhotoUrl: extra.coverPhotoUrl ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Cuenta de fotos y portada por propiedad, en UNA query (evita N+1). */
export async function photoSummaries(
  organizationId: string,
  propertyIds: string[]
): Promise<Map<string, { count: number; coverStorageKey: string | null }>> {
  const summaries = new Map<
    string,
    { count: number; coverStorageKey: string | null }
  >();
  if (propertyIds.length === 0) return summaries;

  const db = getDb();
  const rows = await db
    .select({
      propertyId: schema.propertyPhoto.propertyId,
      position: schema.propertyPhoto.position,
      storageKey: schema.propertyPhoto.storageKey,
    })
    .from(schema.propertyPhoto)
    .where(
      scoped(
        schema.propertyPhoto.organizationId,
        organizationId,
        inArray(schema.propertyPhoto.propertyId, propertyIds)
      )
    )
    .orderBy(asc(schema.propertyPhoto.position));

  for (const row of rows) {
    const current = summaries.get(row.propertyId) ?? {
      count: 0,
      coverStorageKey: null,
    };
    current.count += 1;
    // La portada ES la posición 0 — no hay bandera "es portada".
    if (row.position === 0) current.coverStorageKey = row.storageKey;
    summaries.set(row.propertyId, current);
  }
  return summaries;
}

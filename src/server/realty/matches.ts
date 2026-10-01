import { desc, eq, inArray, isNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import {
  derivedTitle,
  formatPrice,
  formatSpecs,
  formatZone,
} from "@/lib/realty/catalog";
import {
  compareMatches,
  isEligibleProperty,
  rankProperties,
  scoreProperty,
  type MatchReason,
} from "@/server/realty/matching";
import { getCatalogVersion, type PropertyRow } from "@/server/realty/properties";
import { getRequirement } from "@/server/realty/requirements";

/**
 * Cruce lead↔propiedad con caché (parte 2).
 *
 * El `score` guardado es SIEMPRE el determinista
 * (`server/realty/matching.ts`, auditable). No hay explicación de IA inline
 * en esta parte — si se agrega después, debe sumarse sin reordenar ni
 * sobrescribir este score.
 *
 * La caché se invalida por DOS llaves: la versión del requerimiento Y la del
 * inventario (`property_match.requirement_version` /
 * `property_match.catalog_version`). Con solo la primera, una propiedad
 * nueva no aparecería en los paneles hasta que el lead cambiara algo.
 *
 * Portado de `vocero-inmobiliario-main` (`src/server/realty/matches.ts`),
 * sin la capa de IA (fuera de alcance de esta parte).
 */

export const DIRECT_MATCH_LIMIT = 5;
export const INVERSE_MATCH_LIMIT = 20;
/** Cuántos matches se cachean por lead, independientemente del límite pedido. */
const CACHE_LIMIT = 20;

export type MatchResult = {
  property: PropertyRow;
  score: number;
  reasons: MatchReason[];
};

/** Propiedades candidatas: el prefiltro duro vive en `isEligibleProperty`. */
async function availableProperties(
  organizationId: string
): Promise<PropertyRow[]> {
  const db = getDb();
  return db
    .select()
    .from(schema.property)
    .where(
      scoped(
        schema.property.organizationId,
        organizationId,
        isNull(schema.property.archivedAt),
        eq(schema.property.status, "disponible")
      )
    );
}

/**
 * Dirección DIRECTA: lead → propiedades. Top 5 por defecto
 * (`DIRECT_MATCH_LIMIT`), cacheada hasta 20 filas para que un límite mayor no
 * dispare un recálculo.
 */
export async function matchesForLead(input: {
  organizationId: string;
  leadId: string;
  limit?: number;
}): Promise<MatchResult[]> {
  const requirement = await getRequirement(input.organizationId, input.leadId);
  const catalogVersion = await getCatalogVersion(input.organizationId);
  const requirementVersion = requirement?.version ?? 0;
  const limit = input.limit ?? DIRECT_MATCH_LIMIT;

  const cached = await readCache({
    organizationId: input.organizationId,
    leadId: input.leadId,
    requirementVersion,
    catalogVersion,
  });
  if (cached) return cached.slice(0, limit);

  // Se calcula y cachea SIEMPRE el mismo tope, independientemente del límite
  // que pidió quien llama: si la caché guardara solo el top-5 y luego alguien
  // pidiera 20, devolvería 5 filas con las versiones correctas y parecerían
  // el resultado completo. El recorte se hace al final, al leer.
  const properties = await availableProperties(input.organizationId);
  const ranked = rankProperties(requirement ?? {}, properties, CACHE_LIMIT);

  const results: MatchResult[] = ranked.map((r) => ({
    property: r.property,
    score: r.score,
    reasons: r.reasons,
  }));

  await writeCache({
    organizationId: input.organizationId,
    leadId: input.leadId,
    requirementVersion,
    catalogVersion,
    results,
  });

  return results.slice(0, limit);
}

/**
 * Dirección INVERSA: propiedad → leads. Top 20 por defecto
 * (`INVERSE_MATCH_LIMIT`), sin caché propia: se calcula directo contra los
 * requerimientos vivos (no hay una tabla-por-propiedad que versionar aparte).
 *
 * Aplica el MISMO prefiltro que la directa: el panel inverso no debe ofrecer
 * leads para propiedades ya apartadas o cerradas.
 */
export async function leadsForProperty(input: {
  organizationId: string;
  propertyId: string;
  limit?: number;
}): Promise<
  {
    leadId: string;
    contactId: string;
    contactName: string;
    score: number;
    reasons: MatchReason[];
  }[]
> {
  const db = getDb();
  const limit = input.limit ?? INVERSE_MATCH_LIMIT;

  const propertyRows = await db
    .select()
    .from(schema.property)
    .where(
      scoped(
        schema.property.organizationId,
        input.organizationId,
        eq(schema.property.id, input.propertyId)
      )
    )
    .limit(1);
  const property = propertyRows[0];
  if (!property) return [];

  const requirements = await db
    .select({
      requirement: schema.requirement,
      contactId: schema.lead.contactId,
      contactName: schema.contact.name,
    })
    .from(schema.requirement)
    .innerJoin(schema.lead, eq(schema.requirement.leadId, schema.lead.id))
    .innerJoin(schema.contact, eq(schema.lead.contactId, schema.contact.id))
    .where(
      scoped(
        schema.requirement.organizationId,
        input.organizationId,
        isNull(schema.contact.archivedAt)
      )
    );

  const scored = requirements
    .filter((row) => isEligibleProperty(row.requirement, property))
    .map((row) => {
      const { score, reasons } = scoreProperty(row.requirement, property);
      return {
        leadId: row.requirement.leadId,
        contactId: row.contactId,
        contactName: row.contactName,
        score,
        reasons,
      };
    })
    // Un lead con 0 % no es una recomendación: no se muestra.
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || a.leadId.localeCompare(b.leadId));

  return scored.slice(0, limit);
}

/* ============================================================
 * Caché
 * ============================================================ */

async function readCache(input: {
  organizationId: string;
  leadId: string;
  requirementVersion: number;
  catalogVersion: number;
}): Promise<MatchResult[] | null> {
  const db = getDb();
  const rows = await db
    .select({ match: schema.propertyMatch, property: schema.property })
    .from(schema.propertyMatch)
    .innerJoin(
      schema.property,
      eq(schema.propertyMatch.propertyId, schema.property.id)
    )
    .where(
      scoped(
        schema.propertyMatch.organizationId,
        input.organizationId,
        eq(schema.propertyMatch.leadId, input.leadId),
        eq(schema.propertyMatch.requirementVersion, input.requirementVersion),
        eq(schema.propertyMatch.catalogVersion, input.catalogVersion)
      )
    )
    .orderBy(desc(schema.propertyMatch.score))
    .limit(CACHE_LIMIT);

  if (rows.length === 0) return null;

  return rows
    .map((r) => ({
      property: r.property,
      score: r.match.score,
      reasons: (r.match.reasons ?? []) as MatchReason[],
    }))
    .sort((a, b) => compareMatches(a as never, b as never));
}

async function writeCache(input: {
  organizationId: string;
  leadId: string;
  requirementVersion: number;
  catalogVersion: number;
  results: MatchResult[];
}): Promise<void> {
  const db = getDb();
  await db
    .delete(schema.propertyMatch)
    .where(
      scoped(
        schema.propertyMatch.organizationId,
        input.organizationId,
        eq(schema.propertyMatch.leadId, input.leadId)
      )
    );
  if (input.results.length === 0) return;

  await db.insert(schema.propertyMatch).values(
    input.results.map((r) => ({
      id: newId("propertyMatch"),
      organizationId: input.organizationId,
      leadId: input.leadId,
      propertyId: r.property.id,
      score: r.score,
      reasons: r.reasons,
      aiExplanation: null,
      requirementVersion: input.requirementVersion,
      catalogVersion: input.catalogVersion,
    }))
  );
}

/** Invalida a mano (p. ej. al borrar un lead). El flujo normal usa versiones. */
export async function clearMatchCache(
  organizationId: string,
  leadId: string
): Promise<void> {
  await getDb()
    .delete(schema.propertyMatch)
    .where(
      scoped(
        schema.propertyMatch.organizationId,
        organizationId,
        eq(schema.propertyMatch.leadId, leadId)
      )
    );
}

/** Serialización para la API y para el contexto del agente. */
export function serializeMatch(match: MatchResult) {
  return {
    propertyId: match.property.id,
    title:
      match.property.title ??
      derivedTitle(match.property.kind, match.property.city),
    operation: match.property.operation,
    kind: match.property.kind,
    price: formatPrice(match.property.price, match.property.currency),
    zone: formatZone(match.property.neighborhood, match.property.city),
    specs: formatSpecs({
      bedrooms: match.property.bedrooms,
      bathrooms: match.property.bathrooms,
      builtArea: match.property.builtArea,
    }),
    score: match.score,
    reasons: match.reasons,
  };
}

/** Ids de las propiedades que el agente PUEDE nombrar este turno (allowlist). */
export async function candidatePropertyIds(
  organizationId: string,
  leadId: string
): Promise<string[]> {
  const matches = await matchesForLead({
    organizationId,
    leadId,
    limit: DIRECT_MATCH_LIMIT,
  });
  return matches.map((m) => m.property.id);
}

/** Propiedades por id, escopeadas — para resolver acciones del agente. */
export async function propertiesByIds(
  organizationId: string,
  ids: string[]
): Promise<PropertyRow[]> {
  if (ids.length === 0) return [];
  const db = getDb();
  return db
    .select()
    .from(schema.property)
    .where(
      scoped(
        schema.property.organizationId,
        organizationId,
        inArray(schema.property.id, ids)
      )
    );
}

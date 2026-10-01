import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Caché de matches (`property_match`, parte 2): se invalida por versión de
 * requerimiento O de inventario — cualquiera de las dos por separado ya
 * fuerza el recálculo (`readCache` en `server/realty/matches.ts` exige que
 * AMBAS coincidan con las actuales).
 */

const PROPERTY = {
  id: "prop_1",
  organizationId: "org_1",
  operation: "venta",
  kind: "departamento",
  title: null,
  price: "100000",
  currency: "USD",
  neighborhood: "Centro",
  city: "La Paz",
  bedrooms: 2,
  bathrooms: "1",
  amenities: [],
  acceptedPayments: [],
  status: "disponible",
  archivedAt: null,
};

let requirementVersion = 0;
let catalogVersion = 0;
/** Fila guardada en la "tabla" property_match para el lead de prueba. */
let cachedMatch: {
  propertyId: string;
  score: number;
  reasons: unknown[];
  requirementVersion: number;
  catalogVersion: number;
} | null = null;
let recomputeCalls = 0;

vi.mock("@/server/realty/requirements", () => ({
  getRequirement: async () => ({
    version: requirementVersion,
    operation: null,
    zones: [],
    amenities: [],
  }),
}));

vi.mock("@/server/realty/properties", () => ({
  getCatalogVersion: async () => catalogVersion,
}));

function chain(rows: unknown[]) {
  const c: Record<string, unknown> = {};
  for (const m of ["from", "where", "orderBy", "limit", "innerJoin"]) {
    c[m] = () => c;
  }
  (c as { then: unknown }).then = (resolve: (v: unknown) => unknown) =>
    resolve(rows);
  return c;
}

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: (projection?: Record<string, unknown>) => {
      // `readCache` proyecta `{ match, property }`; `availableProperties`
      // hace un select() sin argumentos (fila completa).
      const isReadCache = !!projection && "match" in projection;
      if (isReadCache) {
        const hit =
          cachedMatch &&
          cachedMatch.requirementVersion === requirementVersion &&
          cachedMatch.catalogVersion === catalogVersion;
        return chain(
          hit ? [{ match: cachedMatch, property: PROPERTY }] : []
        );
      }
      recomputeCalls++;
      return chain([]); // sin inventario disponible en este escenario
    },
    delete: () => ({ where: () => Promise.resolve() }),
    insert: () => ({
      values: (rows: Record<string, unknown>[]) => {
        const first = rows[0] as
          | { propertyId: string; score: number; reasons: unknown[]; requirementVersion: number; catalogVersion: number }
          | undefined;
        cachedMatch = first ?? null;
        return Promise.resolve();
      },
    }),
  }),
  schema: {
    property: {
      organizationId: "organizationId",
      archivedAt: "archivedAt",
      status: "status",
      id: "id",
    },
    propertyMatch: {
      organizationId: "organizationId",
      leadId: "leadId",
      propertyId: "propertyId",
      requirementVersion: "requirementVersion",
      catalogVersion: "catalogVersion",
      score: "score",
    },
  },
}));

vi.mock("@/lib/db/ids", () => ({ newId: () => "pma_new" }));

import { matchesForLead } from "@/server/realty/matches";

describe("caché de matches — invalidación por versión", () => {
  beforeEach(() => {
    requirementVersion = 0;
    catalogVersion = 0;
    cachedMatch = null;
    recomputeCalls = 0;
  });

  it("sin caché, calcula contra el inventario y guarda el resultado", async () => {
    const result = await matchesForLead({ organizationId: "org_1", leadId: "ld_1" });
    expect(result).toHaveLength(0); // no hay inventario disponible en el mock
    expect(recomputeCalls).toBe(1);
  });

  it("con caché vigente (mismas versiones), no recalcula", async () => {
    cachedMatch = {
      propertyId: "prop_1",
      score: 80,
      reasons: [],
      requirementVersion: 0,
      catalogVersion: 0,
    };
    const result = await matchesForLead({ organizationId: "org_1", leadId: "ld_1" });
    expect(result).toHaveLength(1);
    expect(result[0]!.score).toBe(80);
    expect(recomputeCalls).toBe(0);
  });

  it("bumpear la versión del requerimiento invalida la caché", async () => {
    cachedMatch = {
      propertyId: "prop_1",
      score: 80,
      reasons: [],
      requirementVersion: 0,
      catalogVersion: 0,
    };
    requirementVersion = 1; // el lead cambió su requerimiento
    const result = await matchesForLead({ organizationId: "org_1", leadId: "ld_1" });
    expect(recomputeCalls).toBe(1); // la caché (version 0) ya no calza
    expect(result).toHaveLength(0); // se recalculó contra 0 candidatas
  });

  it("bumpear la versión del catálogo invalida la caché", async () => {
    cachedMatch = {
      propertyId: "prop_1",
      score: 80,
      reasons: [],
      requirementVersion: 0,
      catalogVersion: 0,
    };
    catalogVersion = 1; // se creó/editó una propiedad
    const result = await matchesForLead({ organizationId: "org_1", leadId: "ld_1" });
    expect(recomputeCalls).toBe(1);
    expect(result).toHaveLength(0);
  });
});

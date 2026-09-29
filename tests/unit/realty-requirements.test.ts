import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Requerimiento del lead (parte 2): precedencia manual > IA y el versionado
 * que invalida la caché de matches (`server/realty/matches.ts`).
 */

let currentRow: Record<string, unknown>;

function baseRow(): Record<string, unknown> {
  return {
    id: "req_1",
    organizationId: "org_1",
    leadId: "ld_1",
    operation: null,
    budgetMin: null,
    budgetMax: null,
    currency: "USD",
    zones: [],
    kind: null,
    minBedrooms: null,
    minBathrooms: null,
    amenities: [],
    paymentMethod: null,
    needsGuarantor: null,
    urgency: null,
    notes: null,
    manualFields: [],
    version: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function chain(rows: unknown[]) {
  const c: Record<string, unknown> = {};
  for (const m of ["from", "where", "limit", "orderBy"]) c[m] = () => c;
  (c as { then: unknown }).then = (resolve: (v: unknown) => unknown) =>
    resolve(rows);
  return c;
}

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => chain([currentRow]),
    update: () => ({
      set: (v: Record<string, unknown>) => ({
        where: () => ({
          returning: () => {
            currentRow = { ...currentRow, ...v };
            return Promise.resolve([currentRow]);
          },
        }),
      }),
    }),
    insert: () => ({
      values: () => ({
        onConflictDoNothing: () => ({
          returning: () => Promise.resolve([currentRow]),
        }),
      }),
    }),
  }),
  schema: {
    requirement: { organizationId: "organizationId", leadId: "leadId", id: "id" },
  },
}));

vi.mock("@/lib/db/ids", () => ({ newId: () => "req_new" }));

import { applyRequirementPatch } from "@/server/realty/requirements";

describe("applyRequirementPatch — precedencia manual > IA", () => {
  beforeEach(() => {
    currentRow = baseRow();
  });

  it("un patch manual fija el campo y sube la versión", async () => {
    const { requirement, changed } = await applyRequirementPatch({
      organizationId: "org_1",
      leadId: "ld_1",
      patch: { budgetMax: "500000" },
      source: "manual",
    });
    expect(changed).toBe(true);
    expect(requirement.budgetMax).toBe("500000");
    expect(requirement.manualFields).toContain("budgetMax");
    expect(requirement.version).toBe(1);
  });

  it("la IA NUNCA sobrescribe un campo que el dueño fijó a mano", async () => {
    await applyRequirementPatch({
      organizationId: "org_1",
      leadId: "ld_1",
      patch: { budgetMax: "500000" },
      source: "manual",
    });

    const { requirement, changed } = await applyRequirementPatch({
      organizationId: "org_1",
      leadId: "ld_1",
      patch: { budgetMax: "999999", operation: "venta" },
      source: "ai",
    });

    // budgetMax se queda protegido; operation sí entra porque no está blindado.
    expect(requirement.budgetMax).toBe("500000");
    expect(requirement.operation).toBe("venta");
    expect(changed).toBe(true);
  });

  it("un patch sin cambios reales no sube la versión", async () => {
    const first = await applyRequirementPatch({
      organizationId: "org_1",
      leadId: "ld_1",
      patch: { budgetMax: "500000" },
      source: "manual",
    });
    expect(first.changed).toBe(true);

    const second = await applyRequirementPatch({
      organizationId: "org_1",
      leadId: "ld_1",
      // Postgres devuelve numeric con escala; el patch manda sin ella.
      patch: { budgetMax: "500000" },
      source: "manual",
    });
    expect(second.changed).toBe(false);
    expect(second.requirement.version).toBe(first.requirement.version);
  });

  it("un `null` explícito borra el campo", async () => {
    await applyRequirementPatch({
      organizationId: "org_1",
      leadId: "ld_1",
      patch: { budgetMax: "500000" },
      source: "manual",
    });
    const { requirement } = await applyRequirementPatch({
      organizationId: "org_1",
      leadId: "ld_1",
      patch: { budgetMax: null },
      source: "manual",
    });
    expect(requirement.budgetMax).toBeNull();
  });
});

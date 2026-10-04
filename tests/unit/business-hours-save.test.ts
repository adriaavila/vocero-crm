import { beforeEach, describe, expect, it, vi } from "vitest";

// La primera importación de una ruta compila medio proyecto: con la máquina cargada pasa de 5 s.
vi.setConfig({ testTimeout: 30_000 });

/** Guardar el horario no cambia lo que el agente dice: no puede volver vieja la prueba. */

const state: { sets: Record<string, unknown>[] } = { sets: [] };
vi.mock("@/lib/db", () => ({
  schema: {
    agentProfile: {
      organizationId: "o", id: "id", businessHours: "bh", businessTimezone: "tz", responseMode: "rm",
    },
  },
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [{ businessHours: {}, businessTimezone: "America/Caracas", responseMode: "outside_hours" }],
        }),
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => {
        state.sets.push(values);
        return { where: () => ({ returning: async () => [{ id: "profile" }] }) };
      },
    }),
  }),
}));
vi.mock("@/lib/db/tenant", () => ({ scoped: () => ({}) }));
vi.mock("@/server/agencia/entitlements", () => ({ hasSaaSPlan: async () => true }));

beforeEach(() => {
  state.sets = [];
});

describe("saveBusinessHours", () => {
  it("guarda el horario sin tocar updated_at (la versión del contenido)", async () => {
    const { saveBusinessHours } = await import("@/server/business-hours");
    await saveBusinessHours("org", {
      weeklyHours: { mon: [{ start: "09:00", end: "18:00" }] },
      timezone: "America/Caracas",
      responseMode: "outside_hours",
    });
    expect(state.sets).toHaveLength(1);
    expect(state.sets[0]).toMatchObject({ businessTimezone: "America/Caracas", responseMode: "outside_hours" });
    expect(state.sets[0]).not.toHaveProperty("updatedAt");
  });
});

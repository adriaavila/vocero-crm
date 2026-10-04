import { beforeEach, describe, expect, it, vi } from "vitest";
import { evaluateReadiness } from "@/server/readiness";

// La primera importación de una ruta compila medio proyecto: con la máquina cargada pasa de 5 s.
vi.setConfig({ testTimeout: 30_000 });

/**
 * Borrar conocimiento cambia lo que el agente dice, pero no deja ninguna fecha
 * nueva (el máximo de `updated_at` de lo que queda no sube). El DELETE mueve la
 * versión del contenido para que una prueba hecha con esa información no siga
 * pareciendo vigente.
 */

const { requireSession } = vi.hoisted(() => ({ requireSession: vi.fn() }));
vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/session")>()),
  requireSession,
}));

const state: { deleted: unknown[]; profileSets: Record<string, unknown>[] } = { deleted: [{ id: "kb_1" }], profileSets: [] };
vi.mock("@/lib/db", () => ({
  schema: { kbEntry: { organizationId: "kb.org", id: "kb.id" }, agentProfile: { organizationId: "profile.org" } },
  getDb: () => ({
    delete: () => ({ where: () => ({ returning: async () => state.deleted }) }),
    update: () => ({
      set: (values: Record<string, unknown>) => {
        state.profileSets.push(values);
        return { where: async () => [] };
      },
    }),
  }),
}));
vi.mock("@/lib/db/tenant", () => ({ scoped: () => ({}) }));

async function del() {
  const { DELETE } = await import("@/app/api/kb/[id]/route");
  return DELETE(new Request("http://localhost/api/kb/kb_1", { method: "DELETE" }), {
    params: Promise.resolve({ id: "kb_1" }),
  });
}

beforeEach(() => {
  requireSession.mockReset();
  requireSession.mockResolvedValue({ userId: "owner", organizationId: "org", role: "owner" });
  state.deleted = [{ id: "kb_1" }];
  state.profileSets = [];
});

describe("DELETE /api/kb/[id]", () => {
  it("mueve la versión del contenido del agente", async () => {
    const response = await del();
    expect(response.status).toBe(200);
    expect(state.profileSets).toHaveLength(1);
    expect(state.profileSets[0]!.updatedAt).toBeInstanceOf(Date);
  });

  it("si no había nada que borrar, no toca nada", async () => {
    state.deleted = [];
    const response = await del();
    expect(response.status).toBe(404);
    expect(state.profileSets).toHaveLength(0);
  });

  it("la prueba pasa, se borra una entrada y la prueba queda vieja", async () => {
    const t0 = new Date("2026-10-03T10:00:00Z");
    const ranAt = new Date("2026-10-03T11:00:00Z");
    const input = (profileUpdatedAt: Date) =>
      ({
        profile: {
          enabled: false, name: "Asistente", tone: "t", greeting: "g", instructions: "i", escalationRules: "e",
          lastLiveTestAt: null, lastLiveTestPassed: null, updatedAt: profileUpdatedAt,
        },
        whatsappConnected: true, aiConfigured: true, liveTestAvailable: false,
        knowledgeCount: 1, knowledgeUpdatedAt: t0,
        latestRun: { id: "r", organizationId: "o", status: "done", score: 90, error: null, startedAt: ranAt, finishedAt: ranAt },
        redCount: 0, brandingCustomized: false, teamMemberCount: 1, businessHoursConfigured: true, saasMode: true, agendaStep: null,
      }) as Parameters<typeof evaluateReadiness>[0];

    const sim = (updatedAt: Date) => evaluateReadiness(input(updatedAt)).steps.find((s) => s.id === "simulation")!.status;
    expect(sim(t0)).toBe("complete");

    // Ocurre la baja de verdad: el perfil toma la fecha que puso el DELETE.
    await del();
    const bumped = state.profileSets[0]!.updatedAt as Date;
    expect(bumped.getTime()).toBeGreaterThan(ranAt.getTime());
    expect(sim(bumped)).toBe("stale");
  });
});

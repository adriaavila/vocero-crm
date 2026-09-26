import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 016 — Las rutas de Ajustes → Anuncios son de propietario, no de cualquier
 * miembro: el dataset y el token publican en nombre del negocio en Meta, lo
 * mismo que la conexión de WhatsApp. Estos tests fijan esa frontera para que
 * una vuelta a `withAuth` (más permisivo) rompa la suite en vez de producción.
 */

const { requireSession } = vi.hoisted(() => ({ requireSession: vi.fn() }));
vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/session")>()),
  requireSession,
}));

const settings = vi.hoisted(() => ({
  getCapiSettingsView: vi.fn(),
  saveCapiSettings: vi.fn(),
  deleteCapiSettings: vi.fn(),
  stageBelongsToOrg: vi.fn(),
}));
vi.mock("@/server/attribution/settings", () => settings);

const conversions = vi.hoisted(() => ({
  listConversionActivity: vi.fn(),
}));
vi.mock("@/server/attribution/conversions", () => conversions);

import { DELETE, GET, PUT } from "@/app/api/settings/capi/route";
import { GET as GET_EVENTS } from "@/app/api/settings/capi/events/route";

const OWNER = { userId: "u_owner", organizationId: "org_1", role: "owner" };
const MEMBER = { userId: "u_member", organizationId: "org_1", role: "member" };

function putReq(body: unknown): Request {
  return new Request("http://localhost/api/settings/capi", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("rutas de /api/settings/capi (propietario únicamente)", () => {
  beforeEach(() => {
    requireSession.mockReset();
    settings.getCapiSettingsView.mockReset().mockResolvedValue(null);
    settings.saveCapiSettings.mockReset().mockResolvedValue(undefined);
    settings.deleteCapiSettings.mockReset().mockResolvedValue(undefined);
    settings.stageBelongsToOrg.mockReset().mockResolvedValue(true);
    conversions.listConversionActivity.mockReset().mockResolvedValue([]);
    vi.stubEnv("ATRIBUCION", "on");
  });
  afterEach(() => vi.unstubAllEnvs());

  describe("con la bandera ATRIBUCION apagada", () => {
    beforeEach(() => vi.stubEnv("ATRIBUCION", "off"));

    it("un miembro recibe 404, no 403 (un 403 confirmaría que el endpoint existe)", async () => {
      requireSession.mockResolvedValue(MEMBER);
      const res = await GET();
      expect(res.status).toBe(404);
      // La bandera gana ANTES de resolver sesión: withOwner/withAuth nunca
      // llegan a correr.
      expect(requireSession).not.toHaveBeenCalled();
      expect(settings.getCapiSettingsView).not.toHaveBeenCalled();
    });

    it("el propietario también recibe 404 — la bandera gana sobre cualquier rol", async () => {
      requireSession.mockResolvedValue(OWNER);
      const res = await GET();
      expect(res.status).toBe(404);
      expect(requireSession).not.toHaveBeenCalled();
    });

    it("los cuatro endpoints responden 404 para un miembro", async () => {
      requireSession.mockResolvedValue(MEMBER);
      const results = await Promise.all([
        GET(),
        PUT(putReq({ datasetId: "ds_1", token: "tok" })),
        DELETE(),
        GET_EVENTS(new Request("http://localhost/api/settings/capi/events")),
      ]);
      for (const res of results) expect(res.status).toBe(404);
      expect(requireSession).not.toHaveBeenCalled();
    });
  });

  describe("un miembro (no propietario) recibe 403 y no toca nada", () => {
    beforeEach(() => requireSession.mockResolvedValue(MEMBER));

    it("GET /api/settings/capi", async () => {
      const res = await GET();
      expect(res.status).toBe(403);
      expect(settings.getCapiSettingsView).not.toHaveBeenCalled();
    });

    it("PUT /api/settings/capi", async () => {
      const res = await PUT(putReq({ datasetId: "ds_1", token: "tok" }));
      expect(res.status).toBe(403);
      expect(settings.saveCapiSettings).not.toHaveBeenCalled();
    });

    it("DELETE /api/settings/capi", async () => {
      const res = await DELETE();
      expect(res.status).toBe(403);
      expect(settings.deleteCapiSettings).not.toHaveBeenCalled();
    });

    it("GET /api/settings/capi/events", async () => {
      const res = await GET_EVENTS(
        new Request("http://localhost/api/settings/capi/events")
      );
      expect(res.status).toBe(403);
      expect(conversions.listConversionActivity).not.toHaveBeenCalled();
    });
  });

  describe("el propietario puede leer y escribir", () => {
    beforeEach(() => requireSession.mockResolvedValue(OWNER));

    it("GET /api/settings/capi → 200", async () => {
      settings.getCapiSettingsView.mockResolvedValue({
        datasetId: "ds_1",
        status: "connected",
        tokenLast4: "abcd",
        qualifiedStageId: null,
      });
      const res = await GET();
      expect(res.status).toBe(200);
      expect(settings.getCapiSettingsView).toHaveBeenCalledWith("org_1");
    });

    it("PUT /api/settings/capi → 200 y guarda", async () => {
      const res = await PUT(putReq({ datasetId: "ds_1", token: "tok" }));
      expect(res.status).toBe(200);
      expect(settings.saveCapiSettings).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: "org_1", datasetId: "ds_1", token: "tok" })
      );
    });

    it("DELETE /api/settings/capi → 200 y borra", async () => {
      const res = await DELETE();
      expect(res.status).toBe(200);
      expect(settings.deleteCapiSettings).toHaveBeenCalledWith("org_1");
    });

    it("GET /api/settings/capi/events → 200", async () => {
      const res = await GET_EVENTS(
        new Request("http://localhost/api/settings/capi/events")
      );
      expect(res.status).toBe(200);
      expect(conversions.listConversionActivity).toHaveBeenCalledWith("org_1", undefined);
    });
  });
});

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { deriveRegistrationPin } from "@/server/agencia/whatsapp-signup/pin";

/**
 * Orquestación de `POST /api/whatsapp/embedded-signup/complete`
 * (server/agencia/whatsapp-signup/complete.ts): orden de operaciones
 * (credenciales → webhook → sync), y los caminos infelices (403/409/502).
 * Todo lo que habla con Meta o con la BD va mockeado.
 */

const graph = {
  exchangeCodeForToken: vi.fn(),
  debugBusinessToken: vi.fn(),
  getMissingPermissions: vi.fn(),
  resolveConnection: vi.fn(),
  subscribeWabaOverride: vi.fn(),
  verifyOverrideWithRetry: vi.fn(),
  registerPhoneNumber: vi.fn(),
  getPhoneCoexistenceStatus: vi.fn(),
  requestSmbAppDataSync: vi.fn(),
};
vi.mock("@/server/agencia/whatsapp-signup/graph", () => graph);

const saveCredentials = vi.fn();
vi.mock("@/server/whatsapp/credentials", () => ({ saveCredentials }));

const syncTemplates = vi.fn();
vi.mock("@/server/whatsapp/templates", () => ({ syncTemplates }));

const syncGuard = {
  getWhatsappSignupSync: vi.fn(),
  alreadySyncedForPhone: vi.fn(),
  recordWhatsappSignupSync: vi.fn(),
};
vi.mock("@/server/agencia/whatsapp-signup/sync-guard", () => syncGuard);

let clashRows: { organizationId: string }[] = [];
vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(clashRows),
        }),
      }),
    }),
  }),
  schema: { metaCredentials: { organizationId: "organization_id", phoneNumberId: "phone_number_id" } },
}));

beforeAll(() => {
  process.env.APP_BASE_URL = "http://localhost:3311";
  process.env.DATABASE_URL = "postgresql://t:t@localhost:5432/t";
  process.env.BETTER_AUTH_SECRET = "secret-de-test-suficiente";
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 5).toString("base64");
  process.env.META_WEBHOOK_VERIFY_TOKEN = "verify-test";
  process.env.META_APP_ID = "app-id-test";
  process.env.META_APP_SECRET = "app-secret-test";
});

const PHONE_PROFILE = { id: "phone_1", display_phone_number: "+52 55 1111 2222", verified_name: "Negocio E2E" };

beforeEach(() => {
  vi.clearAllMocks();
  clashRows = [];
  graph.exchangeCodeForToken.mockResolvedValue("business-token");
  graph.debugBusinessToken.mockResolvedValue({ is_valid: true, scopes: [] });
  graph.getMissingPermissions.mockReturnValue([]);
  graph.resolveConnection.mockResolvedValue({
    wabaId: "waba_1",
    phoneNumberId: "phone_1",
    phoneProfile: PHONE_PROFILE,
  });
  saveCredentials.mockResolvedValue(undefined);
  graph.subscribeWabaOverride.mockResolvedValue(undefined);
  graph.verifyOverrideWithRetry.mockResolvedValue(true);
  graph.registerPhoneNumber.mockResolvedValue({ alreadyRegistered: false });
  graph.getPhoneCoexistenceStatus.mockResolvedValue({ isOnBizApp: true, platformType: "CLOUD_API" });
  graph.requestSmbAppDataSync.mockResolvedValue({ requestId: "req_1" });
  syncGuard.getWhatsappSignupSync.mockResolvedValue(null);
  syncGuard.alreadySyncedForPhone.mockReturnValue(false);
  syncGuard.recordWhatsappSignupSync.mockResolvedValue(undefined);
  syncTemplates.mockResolvedValue(3);
});

async function run(mode: "coexistence" | "cloud_api" = "coexistence") {
  const { runEmbeddedSignupCompletion } = await import("@/server/agencia/whatsapp-signup/complete");
  return runEmbeddedSignupCompletion({
    organizationId: "org_1",
    mode,
    payload: { code: "the-code", state: "the-state", mode },
  });
}

function order(mockFn: { mock: { invocationCallOrder: number[] } }): number {
  const first = mockFn.mock.invocationCallOrder[0];
  if (first === undefined) throw new Error("mock nunca se llamó");
  return first;
}

describe("runEmbeddedSignupCompletion — camino feliz", () => {
  it("coexistencia: credenciales → webhook → verificación → sync, en ese orden, UNA vez", async () => {
    const result = await run("coexistence");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.displayPhoneNumber).toBe(PHONE_PROFILE.display_phone_number);
    expect(result.verifiedName).toBe(PHONE_PROFILE.verified_name);
    expect(result.mode).toBe("coexistence");

    // Orden obligatorio del spec: credenciales primero, webhook después, sync al final.
    expect(order(saveCredentials)).toBeLessThan(order(graph.subscribeWabaOverride));
    expect(order(graph.subscribeWabaOverride)).toBeLessThan(order(graph.verifyOverrideWithRetry));
    expect(order(graph.verifyOverrideWithRetry)).toBeLessThan(order(graph.requestSmbAppDataSync));
    expect(order(graph.verifyOverrideWithRetry)).toBeLessThan(order(graph.getPhoneCoexistenceStatus));

    expect(graph.registerPhoneNumber).not.toHaveBeenCalled();
    expect(graph.requestSmbAppDataSync).toHaveBeenCalledTimes(2); // smb_app_state_sync + history
    expect(syncGuard.recordWhatsappSignupSync).toHaveBeenCalledTimes(1);
    expect(syncTemplates).toHaveBeenCalledWith("org_1");
  });

  it("Cloud API: registra el número (nunca pide sync de coexistencia)", async () => {
    const result = await run("cloud_api");
    expect(result.ok).toBe(true);

    expect(order(saveCredentials)).toBeLessThan(order(graph.subscribeWabaOverride));
    expect(order(graph.subscribeWabaOverride)).toBeLessThan(order(graph.verifyOverrideWithRetry));
    expect(order(graph.verifyOverrideWithRetry)).toBeLessThan(order(graph.registerPhoneNumber));

    const expectedPin = deriveRegistrationPin("phone_1", process.env.ENCRYPTION_KEY!);
    expect(graph.registerPhoneNumber).toHaveBeenCalledWith({
      phoneNumberId: "phone_1",
      token: "business-token",
      pin: expectedPin,
    });
    expect(graph.requestSmbAppDataSync).not.toHaveBeenCalled();
    expect(graph.getPhoneCoexistenceStatus).not.toHaveBeenCalled();
  });

  it("sync una sola vez: si ya se sincronizó ese teléfono, no lo vuelve a pedir", async () => {
    syncGuard.alreadySyncedForPhone.mockReturnValue(true);
    const result = await run("coexistence");
    expect(result.ok).toBe(true);
    expect(graph.requestSmbAppDataSync).not.toHaveBeenCalled();
    expect(syncGuard.recordWhatsappSignupSync).not.toHaveBeenCalled();
  });
});

describe("runEmbeddedSignupCompletion — caminos infelices", () => {
  it("502 si Meta devuelve un token de negocio inválido", async () => {
    graph.debugBusinessToken.mockResolvedValue({ is_valid: false });
    const result = await run();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(502);
    expect(result.step).toBe("debug_token");
    expect(saveCredentials).not.toHaveBeenCalled();
  });

  it("403 si faltan permisos, y los reporta", async () => {
    graph.getMissingPermissions.mockReturnValue(["whatsapp_business_management"]);
    const result = await run();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(403);
    expect(result.step).toBe("permissions");
    expect(result.missingPermissions).toEqual(["whatsapp_business_management"]);
    expect(graph.resolveConnection).not.toHaveBeenCalled();
  });

  it("409 si el número ya está conectado a OTRA organización (pre-chequeo)", async () => {
    clashRows = [{ organizationId: "org_otro" }];
    const result = await run();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(409);
    expect(result.step).toBe("phone_in_use");
    expect(saveCredentials).not.toHaveBeenCalled();
  });

  it("409 si la carrera la detecta el índice único al guardar (catch)", async () => {
    clashRows = []; // el pre-chequeo pasa…
    saveCredentials.mockRejectedValue({ code: "23505", constraint_name: "meta_credentials_phone_uq" });
    const result = await run();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(409);
    expect(result.step).toBe("phone_in_use");
  });

  it("409 si no se puede identificar un único número (resolveConnection → null)", async () => {
    graph.resolveConnection.mockResolvedValue(null);
    const result = await run();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(409);
    expect(result.step).toBe("resolve");
  });

  it("502 si Meta no confirma el override del webhook tras los reintentos", async () => {
    graph.verifyOverrideWithRetry.mockResolvedValue(false);
    const result = await run();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(502);
    expect(result.step).toBe("webhook_verify");
  });

  it("mejor esfuerzo: si el sync de coexistencia falla, el alta sigue en ok", async () => {
    syncGuard.getWhatsappSignupSync.mockRejectedValue(new Error("boom"));
    const result = await run("coexistence");
    expect(result.ok).toBe(true);
  });

  it("mejor esfuerzo: si el sync de plantillas falla, el alta sigue en ok", async () => {
    syncTemplates.mockRejectedValue(new Error("boom"));
    const result = await run("coexistence");
    expect(result.ok).toBe(true);
  });
});

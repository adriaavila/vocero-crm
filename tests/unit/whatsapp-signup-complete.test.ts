import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { deriveRegistrationPin } from "@/server/agencia/whatsapp-signup/pin";
import { copyForStep } from "@/server/agencia/whatsapp-signup/copy";

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
  PIN_MISMATCH_CODE: 133005,
};
vi.mock("@/server/agencia/whatsapp-signup/graph", () => graph);

const saveCredentials = vi.fn();
vi.mock("@/server/whatsapp/credentials", () => ({ saveCredentials }));

const syncTemplates = vi.fn();
vi.mock("@/server/whatsapp/templates", () => ({ syncTemplates }));

const syncGuard = {
  claimWhatsappSignupSync: vi.fn(),
  finalizeWhatsappSignupSync: vi.fn(),
  releaseWhatsappSignupSync: vi.fn(),
  recordWhatsappSignupError: vi.fn(),
  clearWhatsappSignupError: vi.fn(),
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

class FakeMetaApiError extends Error {
  status: number;
  code: number | null;
  constructor(message: string, opts: { status: number; code?: number | null }) {
    super(message);
    this.name = "MetaApiError";
    this.status = opts.status;
    this.code = opts.code ?? null;
  }
}
vi.mock("@/lib/meta/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/meta/client")>("@/lib/meta/client");
  return { ...actual, MetaApiError: FakeMetaApiError };
});

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
  syncGuard.claimWhatsappSignupSync.mockResolvedValue(true);
  syncGuard.finalizeWhatsappSignupSync.mockResolvedValue(undefined);
  syncGuard.releaseWhatsappSignupSync.mockResolvedValue(undefined);
  syncGuard.recordWhatsappSignupError.mockResolvedValue(undefined);
  syncGuard.clearWhatsappSignupError.mockResolvedValue(undefined);
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
    expect(order(graph.verifyOverrideWithRetry)).toBeLessThan(order(syncGuard.claimWhatsappSignupSync));
    expect(order(syncGuard.claimWhatsappSignupSync)).toBeLessThan(order(graph.requestSmbAppDataSync));

    expect(graph.registerPhoneNumber).not.toHaveBeenCalled();
    expect(graph.requestSmbAppDataSync).toHaveBeenCalledTimes(2); // smb_app_state_sync + history
    expect(syncGuard.finalizeWhatsappSignupSync).toHaveBeenCalledTimes(1);
    expect(syncGuard.releaseWhatsappSignupSync).not.toHaveBeenCalled();
    expect(syncGuard.clearWhatsappSignupError).toHaveBeenCalledWith("org_1");
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
    expect(syncGuard.claimWhatsappSignupSync).not.toHaveBeenCalled();
  });

  it("sync una sola vez: la reserva atómica niega un segundo intento del mismo número", async () => {
    syncGuard.claimWhatsappSignupSync.mockResolvedValue(false); // ya reservado
    const result = await run("coexistence");
    expect(result.ok).toBe(true);
    expect(graph.requestSmbAppDataSync).not.toHaveBeenCalled();
    expect(syncGuard.finalizeWhatsappSignupSync).not.toHaveBeenCalled();
  });

  it("si AMBOS envíos de sync fallan, libera la reserva (no queda 'gastada' sin haberse pedido)", async () => {
    graph.requestSmbAppDataSync.mockRejectedValue(new Error("network"));
    const result = await run("coexistence");
    expect(result.ok).toBe(true);
    expect(syncGuard.releaseWhatsappSignupSync).toHaveBeenCalledWith("org_1", "phone_1");
    expect(syncGuard.finalizeWhatsappSignupSync).not.toHaveBeenCalled();
  });

  it("si SOLO uno de los dos envíos falla, conserva la reserva (finaliza, no libera)", async () => {
    graph.requestSmbAppDataSync
      .mockResolvedValueOnce({ requestId: "req_ok" })
      .mockRejectedValueOnce(new Error("network"));
    const result = await run("coexistence");
    expect(result.ok).toBe(true);
    expect(syncGuard.finalizeWhatsappSignupSync).toHaveBeenCalledTimes(1);
    expect(syncGuard.releaseWhatsappSignupSync).not.toHaveBeenCalled();
  });
});

describe("runEmbeddedSignupCompletion — copys fijos (nunca el texto crudo de Meta)", () => {
  it("el error nunca lleva el mensaje real de Meta, siempre el copy fijo del paso", async () => {
    graph.exchangeCodeForToken.mockRejectedValue(
      new FakeMetaApiError("Meta secret internal detail xyz", { status: 502 })
    );
    const result = await run();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe(copyForStep("exchange"));
    expect(result.error).not.toContain("xyz");
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

  it("502 si Meta no confirma el override del webhook tras los reintentos, y anota el error", async () => {
    graph.verifyOverrideWithRetry.mockResolvedValue(false);
    const result = await run();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(502);
    expect(result.step).toBe("webhook_verify");
    expect(syncGuard.recordWhatsappSignupError).toHaveBeenCalledWith("org_1", "phone_1", "webhook_verify");
  });

  it("502 con step 'register_pin_mismatch' si Meta responde 133005 (PIN incorrecto), no el genérico", async () => {
    graph.registerPhoneNumber.mockRejectedValue(
      new FakeMetaApiError("PIN incorrecto", { status: 400, code: 133005 })
    );
    const result = await run("cloud_api");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.step).toBe("register_pin_mismatch");
    expect(result.error).toBe(copyForStep("register_pin_mismatch"));
    expect(syncGuard.recordWhatsappSignupError).toHaveBeenCalledWith("org_1", "phone_1", "register_pin_mismatch");
  });

  it("502 con step 'register' genérico para cualquier OTRO error de Meta en el registro", async () => {
    graph.registerPhoneNumber.mockRejectedValue(new FakeMetaApiError("otra cosa", { status: 400, code: 1 }));
    const result = await run("cloud_api");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.step).toBe("register");
  });

  it("mejor esfuerzo: si el sync de coexistencia falla al reservar, el alta sigue en ok", async () => {
    syncGuard.claimWhatsappSignupSync.mockRejectedValue(new Error("boom"));
    const result = await run("coexistence");
    expect(result.ok).toBe(true);
  });

  it("mejor esfuerzo: si el sync de plantillas falla, el alta sigue en ok", async () => {
    syncTemplates.mockRejectedValue(new Error("boom"));
    const result = await run("coexistence");
    expect(result.ok).toBe(true);
  });
});

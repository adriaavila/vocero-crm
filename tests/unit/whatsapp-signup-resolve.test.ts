import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * `resolveConnection` (server/agencia/whatsapp-signup/graph.ts): WABA + número
 * del evento del SDK, o por descubrimiento vía scopes granulares del token.
 * `graphRequest` se mockea para no pegarle a Meta ni al wa-mock.
 */

const graphRequestMock = vi.fn();

vi.mock("@/lib/meta/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/meta/client")>("@/lib/meta/client");
  return { ...actual, graphRequest: (...args: unknown[]) => graphRequestMock(...args) };
});

beforeAll(() => {
  process.env.APP_BASE_URL = "http://localhost:3311";
  process.env.DATABASE_URL = "postgresql://t:t@localhost:5432/t";
  process.env.BETTER_AUTH_SECRET = "secret-de-test-suficiente";
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 3).toString("base64");
  process.env.META_WEBHOOK_VERIFY_TOKEN = "verify-test";
  process.env.META_APP_ID = "app-id-test";
  process.env.META_APP_SECRET = "app-secret-test";
});

afterEach(() => {
  graphRequestMock.mockReset();
});

function phonesFor(wabaId: string, phones: { id: string }[]) {
  graphRequestMock.mockImplementation(async (path: string) => {
    if (path === `${wabaId}/phone_numbers?fields=id,display_phone_number,verified_name`) {
      return { data: phones };
    }
    throw new Error(`ruta inesperada en el test: ${path}`);
  });
}

describe("resolveConnection", () => {
  it("con wabaId + phoneNumberId explícitos, confirma el par contra la WABA", async () => {
    const { resolveConnection } = await import("@/server/agencia/whatsapp-signup/graph");
    phonesFor("waba_1", [{ id: "phone_1" }, { id: "phone_2" }]);
    const result = await resolveConnection({
      token: "tok",
      wabaId: "waba_1",
      phoneNumberId: "phone_2",
      debug: {},
    });
    expect(result).toEqual({
      wabaId: "waba_1",
      phoneNumberId: "phone_2",
      phoneProfile: { id: "phone_2" },
    });
  });

  it("el par no cuadra (el teléfono no pertenece a esa WABA) → null", async () => {
    const { resolveConnection } = await import("@/server/agencia/whatsapp-signup/graph");
    phonesFor("waba_1", [{ id: "phone_1" }]);
    const result = await resolveConnection({
      token: "tok",
      wabaId: "waba_1",
      phoneNumberId: "phone_no_es_de_esta_waba",
      debug: {},
    });
    expect(result).toBeNull();
  });

  it("sin ids explícitos, descubre por scopes granulares: un único candidato resuelve", async () => {
    const { resolveConnection } = await import("@/server/agencia/whatsapp-signup/graph");
    graphRequestMock.mockImplementation(async (path: string) => {
      if (path.startsWith("waba_a/phone_numbers")) return { data: [{ id: "phone_a" }] };
      if (path.startsWith("waba_b/phone_numbers")) return { data: [] };
      throw new Error(`ruta inesperada: ${path}`);
    });
    const result = await resolveConnection({
      token: "tok",
      debug: {
        granular_scopes: [
          { scope: "whatsapp_business_management", target_ids: ["waba_a", "waba_b"] },
        ],
      },
    });
    expect(result).toEqual({ wabaId: "waba_a", phoneNumberId: "phone_a", phoneProfile: { id: "phone_a" } });
  });

  it("varios candidatos y ningún phoneNumberId para desambiguar → null (ambiguo)", async () => {
    const { resolveConnection } = await import("@/server/agencia/whatsapp-signup/graph");
    graphRequestMock.mockImplementation(async (path: string) => {
      if (path.startsWith("waba_a/phone_numbers")) return { data: [{ id: "phone_a" }] };
      if (path.startsWith("waba_b/phone_numbers")) return { data: [{ id: "phone_b" }] };
      throw new Error(`ruta inesperada: ${path}`);
    });
    const result = await resolveConnection({
      token: "tok",
      debug: {
        granular_scopes: [
          { scope: "whatsapp_business_management", target_ids: ["waba_a", "waba_b"] },
        ],
      },
    });
    expect(result).toBeNull();
  });

  it("varios candidatos PERO con phoneNumberId, elige el correcto entre las WABAs", async () => {
    const { resolveConnection } = await import("@/server/agencia/whatsapp-signup/graph");
    graphRequestMock.mockImplementation(async (path: string) => {
      if (path.startsWith("waba_a/phone_numbers")) return { data: [{ id: "phone_a" }] };
      if (path.startsWith("waba_b/phone_numbers")) return { data: [{ id: "phone_b" }] };
      throw new Error(`ruta inesperada: ${path}`);
    });
    const result = await resolveConnection({
      token: "tok",
      phoneNumberId: "phone_b",
      debug: {
        granular_scopes: [
          { scope: "whatsapp_business_management", target_ids: ["waba_a", "waba_b"] },
        ],
      },
    });
    expect(result?.wabaId).toBe("waba_b");
  });

  it("sin scopes de whatsapp y sin ids → null, no ninguna otra WABA", async () => {
    const { resolveConnection } = await import("@/server/agencia/whatsapp-signup/graph");
    const result = await resolveConnection({
      token: "tok",
      debug: { granular_scopes: [{ scope: "pages_show_list", target_ids: ["page_1"] }] },
    });
    expect(result).toBeNull();
    expect(graphRequestMock).not.toHaveBeenCalled();
  });
});

describe("getMissingPermissions", () => {
  it("sin permisos concedidos, exige los dos", async () => {
    const { getMissingPermissions } = await import("@/server/agencia/whatsapp-signup/graph");
    expect(getMissingPermissions({})).toEqual([
      "whatsapp_business_management",
      "whatsapp_business_messaging",
    ]);
  });

  it("con ambos en scopes planos, no falta ninguno", async () => {
    const { getMissingPermissions } = await import("@/server/agencia/whatsapp-signup/graph");
    expect(
      getMissingPermissions({
        scopes: ["whatsapp_business_management", "whatsapp_business_messaging"],
      })
    ).toEqual([]);
  });

  it("un permiso solo en granular_scopes también cuenta", async () => {
    const { getMissingPermissions } = await import("@/server/agencia/whatsapp-signup/graph");
    expect(
      getMissingPermissions({
        scopes: ["whatsapp_business_messaging"],
        granular_scopes: [{ scope: "whatsapp_business_management", target_ids: ["waba_1"] }],
      })
    ).toEqual([]);
  });
});

describe("subscriptionMatchesOverride", () => {
  it("coincide por id de app + URL normalizada", async () => {
    const { subscriptionMatchesOverride } = await import("@/server/agencia/whatsapp-signup/graph");
    expect(
      subscriptionMatchesOverride(
        { id: "app_1", override_callback_uri: "https://x.test/api/webhooks/wa/tok" },
        "app_1",
        "https://x.test/api/webhooks/wa/tok"
      )
    ).toBe(true);
  });

  it("Meta puede omitir el id de la app: la URL sigue siendo verificable", async () => {
    const { subscriptionMatchesOverride } = await import("@/server/agencia/whatsapp-signup/graph");
    expect(
      subscriptionMatchesOverride(
        { override_callback_uri: "https://x.test/api/webhooks/wa/tok" },
        "app_1",
        "https://x.test/api/webhooks/wa/tok"
      )
    ).toBe(true);
  });

  it("no coincide si la URL es de otra instancia", async () => {
    const { subscriptionMatchesOverride } = await import("@/server/agencia/whatsapp-signup/graph");
    expect(
      subscriptionMatchesOverride(
        { id: "app_1", override_callback_uri: "https://otra.test/api/webhooks/wa/tok" },
        "app_1",
        "https://x.test/api/webhooks/wa/tok"
      )
    ).toBe(false);
  });
});

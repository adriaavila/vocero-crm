import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Fork — guardar el asistente manual (PUT /api/settings/whatsapp) sobre una
 * WABA que ya enruta a un override (alta guiada, modo agencia, handover) NO
 * puede borrarlo: sus webhooks volverían al callback por defecto de la app y
 * el CRM dejaría de recibir mensajes en silencio.
 *
 * `subscribed-apps.test.ts` (de upstream) mockea `graphRequest`. Aquí el
 * cliente real habla con el wa-mock real —el destino de `META_GRAPH_BASE_URL`—
 * que se porta como Meta: un `POST subscribed_apps` sin cuerpo BORRA el
 * override. Con el POST ciego de antes, el primer caso falla.
 */

const GRAPH = "http://localhost:3311/api/dev/wa-mock/graph";
const TOKEN = "tok-test";
const OVERRIDE = "https://crm.ejemplo.com/api/webhooks/wa/verify-test";

beforeAll(async () => {
  process.env.APP_BASE_URL = "http://localhost:3311";
  process.env.DATABASE_URL = "postgresql://t:t@localhost:5432/t";
  process.env.BETTER_AUTH_SECRET = "secret-de-test-suficiente";
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 3).toString("base64");
  process.env.META_WEBHOOK_VERIFY_TOKEN = "verify-test";
  process.env.WA_MOCK_ENABLED = "true";
  process.env.META_GRAPH_BASE_URL = GRAPH;
  (await import("@/lib/env")).resetEnvCacheForTests();
});

beforeEach(async () => {
  const mock = await import("@/app/api/dev/wa-mock/graph/[...path]/route");
  (await import("@/server/dev/wa-mock-state")).resetWaMockState();
  vi.spyOn(console, "log").mockImplementation(() => {});
  // `graphRequest` sale por fetch: se entrega al handler del wa-mock, sin red.
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    if (!url.startsWith(`${GRAPH}/`)) throw new Error(`fuera del wa-mock: ${url}`);
    const path = new URL(url).pathname.slice(new URL(GRAPH).pathname.length + 1).split("/");
    const handler = init?.method === "POST" ? mock.POST : mock.GET;
    return handler(new Request(url, init), { params: Promise.resolve({ path }) });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function modules() {
  const graph = await import("@/server/agencia/whatsapp-signup/graph");
  const { subscribeAppToWaba } = await import("@/server/whatsapp/connect");
  const { graphRequest } = await import("@/lib/meta/client");
  /** Lo que deja el alta guiada, o el backend de la agencia. */
  const fijarOverride = (wabaId: string) =>
    graph.subscribeWabaOverride({ wabaId, token: TOKEN, callbackUri: OVERRIDE, verifyToken: "verify-test" });
  return { ...graph, subscribeAppToWaba, graphRequest, fijarOverride };
}

describe("asistente manual sobre una WABA que ya tiene override", () => {
  it("el override sobrevive a guardar la conexión", async () => {
    const { fijarOverride, subscribeAppToWaba, listSubscribedApps } = await modules();
    await fijarOverride("WABA-1");

    await subscribeAppToWaba("WABA-1", TOKEN); // lo que hace el PUT al guardar

    const apps = await listSubscribedApps("WABA-1", TOKEN);
    expect(apps.map((app) => app.override_callback_uri)).toEqual([OVERRIDE]);
  });

  it("si Meta no responde a la consulta, tampoco se toca el override", async () => {
    const { fijarOverride, subscribeAppToWaba, listSubscribedApps } = await modules();
    await fijarOverride("WABA-1");
    const mock = globalThis.fetch;
    let caida = true; // solo la primera llamada (el GET previo) se pierde
    vi.stubGlobal("fetch", (...args: Parameters<typeof fetch>) => {
      if (caida) {
        caida = false;
        return Promise.reject(new Error("red caída"));
      }
      return mock(...args);
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});

    await subscribeAppToWaba("WABA-1", TOKEN);

    const apps = await listSubscribedApps("WABA-1", TOKEN);
    expect(apps.map((app) => app.override_callback_uri)).toEqual([OVERRIDE]);
  });

  it("sin override, guardar sigue suscribiendo la app (modo directo)", async () => {
    const { subscribeAppToWaba, listSubscribedApps } = await modules();
    expect(await listSubscribedApps("WABA-2", TOKEN)).toEqual([]);

    await subscribeAppToWaba("WABA-2", TOKEN);

    const apps = await listSubscribedApps("WABA-2", TOKEN);
    expect(apps).toHaveLength(1);
    expect(apps[0]?.override_callback_uri).toBeUndefined();
  });

  it("control: el wa-mock borra el override ante un POST sin cuerpo, como Meta", async () => {
    const { fijarOverride, graphRequest, listSubscribedApps } = await modules();
    await fijarOverride("WABA-1");

    await graphRequest("WABA-1/subscribed_apps", { method: "POST", token: TOKEN });

    const apps = await listSubscribedApps("WABA-1", TOKEN);
    expect(apps).toHaveLength(1);
    expect(apps[0]?.override_callback_uri).toBeUndefined();
  });
});

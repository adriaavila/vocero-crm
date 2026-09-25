import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `POST /api/bot/messages` sobre una conversación `is_test`: antes fallaba
 * con `sandbox_violation` (el sender real la rechaza, correctamente — FR-031)
 * porque la ruta llamaba a `sendText` sin mirar `isTest`. Con Nea como
 * cerebro por defecto, el Laboratorio pasa por esta misma ruta, así que debe
 * persistir el saliente de prueba (igual que el pipeline in-process) y JAMÁS
 * tocar la API real.
 */

const { sendText } = vi.hoisted(() => ({ sendText: vi.fn() }));
vi.mock("@/server/inbox/send", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/inbox/send")>();
  return { ...actual, sendText };
});

vi.mock("@/server/bot/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/bot/auth")>();
  return { ...actual, resolveInstanceOrg: async () => "org_1" };
});

const selectQueue: unknown[][] = [];
const inserts: { table: unknown; values: Record<string, unknown> }[] = [];

function thenableChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "innerJoin", "where", "orderBy", "limit"]) {
    chain[m] = () => chain;
  }
  (chain as { then: unknown }).then = (resolve: (v: unknown) => void) =>
    Promise.resolve(rows).then(resolve);
  return chain;
}

vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  return {
    ...actual,
    getDb: () => ({
      select: () => thenableChain(selectQueue.shift() ?? []),
      insert: (table: unknown) => ({
        values: (values: Record<string, unknown>) => {
          inserts.push({ table, values });
          const chain = {
            returning: () => Promise.resolve([values]),
            then: (resolve: (v: unknown) => void) => Promise.resolve([values]).then(resolve),
          };
          return chain;
        },
      }),
      update: () => ({
        set: () => ({
          where: () => ({
            then: (resolve: (v: unknown) => void) => Promise.resolve([{}]).then(resolve),
          }),
        }),
      }),
    }),
  };
});

import { resetRateLimit } from "@/lib/rate-limit";
import { POST } from "@/app/api/bot/messages/route";

const KEY = "clave-de-servicio-larga-0123456789abcdef";

function req(body: unknown): Request {
  return new Request("http://localhost/api/bot/messages", {
    method: "POST",
    headers: { "x-api-key": KEY, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/bot/messages sobre una conversación de prueba", () => {
  beforeEach(() => {
    vi.stubEnv("BOT_API_KEY", KEY);
    resetRateLimit();
    selectQueue.length = 0;
    inserts.length = 0;
    sendText.mockReset();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("se persiste como saliente de prueba y responde {messageId}, sin llamar a sendText", async () => {
    selectQueue.push([
      { id: "cv_lab", organizationId: "org_1", isTest: true, aiEnabled: true, handoffAt: null },
    ]);

    const res = await POST(req({ conversationId: "cv_lab", text: "hola desde Nea" }));

    expect(res.status).toBe(200);
    const body = (await res.json()) as { messageId?: string };
    expect(body.messageId).toBeTruthy();
    expect(sendText).not.toHaveBeenCalled();

    const outbound = inserts.find((i) => i.values.direction === "out");
    expect(outbound?.values).toMatchObject({
      text: "hola desde Nea",
      aiGenerated: true,
      origin: "ai",
    });
  });

  it("conversación real sigue yendo por sendText como antes", async () => {
    selectQueue.push([
      { id: "cv_real", organizationId: "org_1", isTest: false, aiEnabled: true, handoffAt: null },
    ]);
    sendText.mockResolvedValue({ messageId: "message_real_1" });

    const res = await POST(req({ conversationId: "cv_real", text: "hola" }));

    expect(res.status).toBe(200);
    expect(sendText).toHaveBeenCalledTimes(1);
    expect(inserts.some((i) => i.values.direction === "out")).toBe(false);
  });
});

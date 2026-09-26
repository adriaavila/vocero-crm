import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `POST /api/bot/messages` sobre una conversación `is_test`.
 *
 * CON Nea (`isNeaBrain()`): se persiste como saliente de prueba (igual que
 * el pipeline in-process) y JAMÁS toca la API real — el Laboratorio pasa
 * por esta misma ruta cuando Nea contesta.
 *
 * SIN Nea (comportamiento de `main`, sin cambios): esas conversaciones no
 * son alcanzables desde fuera a propósito, así que un cerebro externo que
 * las tocara sigue recibiendo el guardarraíl duro de siempre —
 * `sandbox_violation` vía `sendText` (aquí simulado, ya que `sendText` real
 * es quien lo lanza).
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
/** Ids ya "insertados" — para simular `ON CONFLICT (id) DO NOTHING` de verdad. */
const insertedIds = new Set<string>();

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
          const id = values.id as string;
          const alreadyInserted = insertedIds.has(id);
          const record = () => {
            if (!alreadyInserted) {
              insertedIds.add(id);
              inserts.push({ table, values });
            }
          };
          const chain = {
            // Camino de siempre (sin id determinista): inserta directo, sin
            // chequear conflicto — no lo usa `persistTestOutbound`, pero
            // otros llamadores de este mock sí podrían.
            returning: () => {
              record();
              return Promise.resolve([values]);
            },
            onConflictDoNothing: () => ({
              returning: () => {
                if (alreadyInserted) return Promise.resolve([]);
                record();
                return Promise.resolve([values]);
              },
            }),
            then: (resolve: (v: unknown) => void) => {
              record();
              return Promise.resolve([values]).then(resolve);
            },
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
import { SendError } from "@/server/inbox/send";
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
    insertedIds.clear();
    sendText.mockReset();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("con Nea (NEA_DISPATCH_URL): se persiste como saliente de prueba y responde {messageId}, sin llamar a sendText", async () => {
    vi.stubEnv("NEA_DISPATCH_URL", "http://nea-agent:8000/dispatch");
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

  it("SIN Nea (solo BOT_API_KEY, comportamiento de main): sigue yendo por sendText y responde 409 sandbox_violation", async () => {
    selectQueue.push([
      { id: "cv_lab", organizationId: "org_1", isTest: true, aiEnabled: true, handoffAt: null },
    ]);
    sendText.mockRejectedValue(
      new SendError("sandbox_violation", "Conversación de prueba: el envío real está prohibido")
    );

    const res = await POST(req({ conversationId: "cv_lab", text: "hola" }));

    expect(res.status).toBe(409);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe("sandbox_violation");
    expect(sendText).toHaveBeenCalledTimes(1);
    expect(inserts.some((i) => i.values.direction === "out")).toBe(false);
  });

  it("Laboratorio con dispatchId: el MISMO dispatchId+seq dos veces → una sola fila (ON CONFLICT DO NOTHING), la segunda responde duplicate:true", async () => {
    vi.stubEnv("NEA_DISPATCH_URL", "http://nea-agent:8000/dispatch");
    selectQueue.push([
      { id: "cv_lab", organizationId: "org_1", isTest: true, aiEnabled: true, handoffAt: null },
    ]);
    const res1 = await POST(
      req({ conversationId: "cv_lab", text: "hola desde Nea", dispatchId: "dsp_lab_1", seq: 0 })
    );
    expect(res1.status).toBe(200);
    const body1 = (await res1.json()) as { messageId?: string; duplicate?: boolean };
    expect(body1.duplicate).toBeUndefined();

    selectQueue.push([
      { id: "cv_lab", organizationId: "org_1", isTest: true, aiEnabled: true, handoffAt: null },
    ]);
    const res2 = await POST(
      req({ conversationId: "cv_lab", text: "hola desde Nea", dispatchId: "dsp_lab_1", seq: 0 })
    );
    expect(res2.status).toBe(200);
    const body2 = (await res2.json()) as { messageId?: string; duplicate?: boolean };

    expect(body2.messageId).toBe(body1.messageId);
    expect(body2.duplicate).toBe(true);
    // Solo UNA fila realmente insertada, no dos.
    expect(inserts.filter((i) => i.values.direction === "out")).toHaveLength(1);
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

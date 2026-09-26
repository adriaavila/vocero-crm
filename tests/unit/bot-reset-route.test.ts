import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `POST /api/bot/reset` (dispatch v2): con `notice`, se manda ANTES de fijar
 * `memory_reset_at` — así el aviso mismo queda ANTES del corte y no vuelve a
 * aparecer en `history` de despachos futuros. Las ofertas vigentes se
 * limpian. El resto (ficha vaciada, etapa al inicio) sigue igual que antes.
 */

vi.mock("@/server/bot/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/bot/auth")>();
  return { ...actual, resolveInstanceOrg: async () => "org_1" };
});

/** `order`: sella CUÁNDO (en secuencia global) pasó cada evento relevante,
 * para probar "el aviso se manda ANTES del update con memory_reset_at" sin
 * fake timers ni relojes reales. Todo en `vi.hoisted` porque los `vi.mock`
 * de más abajo se hoistean por encima de cualquier `const` normal. */
const { sendText, order, seal } = vi.hoisted(() => {
  const order: string[] = [];
  const seal = (label: string) => order.push(label);
  return {
    order,
    seal,
    sendText: vi.fn(async () => {
      seal("sendText");
      return { messageId: "msg_aviso" };
    }),
  };
});
vi.mock("@/server/inbox/send", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/inbox/send")>();
  return { ...actual, sendText };
});

const { clearOffers } = vi.hoisted(() => ({ clearOffers: vi.fn(async () => {}) }));
vi.mock("@/server/agenda/offers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/agenda/offers")>();
  return { ...actual, clearOffers };
});

const { upsertFicha } = vi.hoisted(() => ({ upsertFicha: vi.fn(async () => null) }));
vi.mock("@/server/bot/ficha", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/bot/ficha")>();
  return { ...actual, upsertFicha };
});

const { moveLeadToStage } = vi.hoisted(() => ({ moveLeadToStage: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/server/leads/stage-history", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/leads/stage-history")>();
  return { ...actual, moveLeadToStage };
});

vi.mock("@/server/events/bus", () => ({ publish: vi.fn() }));

const selectQueue: unknown[][] = [];
const updates: Record<string, unknown>[] = [];

/** Cadena "todo-terreno": encadena y también es awaitable directo (sin
 * `.limit()`), como en `stages = await db.select().from(...).where(...)`. */
function chain(rows: unknown[]) {
  const c: Record<string, unknown> = {};
  for (const m of ["from", "where", "orderBy", "innerJoin", "leftJoin", "limit"]) c[m] = () => c;
  (c as { then: unknown }).then = (resolve: (v: unknown) => unknown) => Promise.resolve(rows).then(resolve);
  return c;
}

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => chain(selectQueue.shift() ?? []),
    update: () => ({
      set: (values: Record<string, unknown>) => {
        updates.push(values);
        if ("memoryResetAt" in values) seal("update-memory-reset");
        return { where: () => Promise.resolve(undefined) };
      },
    }),
  }),
  schema: new Proxy(
    {},
    { get: (_t, tableName) => new Proxy({}, { get: (_t2, col) => `${String(tableName)}.${String(col)}` }) }
  ),
}));

import { resetRateLimit } from "@/lib/rate-limit";
import { SendError } from "@/server/inbox/send";
import { POST } from "@/app/api/bot/reset/route";

const KEY = "clave-de-servicio-larga-0123456789abcdef";

function req(body: unknown): Request {
  return new Request("http://localhost/api/bot/reset", {
    method: "POST",
    headers: { "x-api-key": KEY, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const CONV = { id: "cv_1", contactId: "ct_1" };
const CONTACT_ROW = { id: "ct_1", organizationId: "org_1", ficha: {} };

/** Cola completa para un reset feliz sin etapas/leads (los pasos best-effort no revientan sin ellos). */
function pushHappyPath() {
  selectQueue.push([CONV]); // la conversación
  selectQueue.push([CONTACT_ROW]); // el contacto (ficha)
  selectQueue.push([]); // etapas (best-effort, ninguna)
  selectQueue.push([]); // lead (best-effort, ninguno)
}

describe("POST /api/bot/reset", () => {
  beforeEach(() => {
    vi.stubEnv("BOT_API_KEY", KEY);
    resetRateLimit();
    selectQueue.length = 0;
    updates.length = 0;
    order.length = 0;
    sendText.mockClear();
    clearOffers.mockClear();
    upsertFicha.mockClear();
    moveLeadToStage.mockClear();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("sin notice: reinicia igual que antes (aiEnabled, handoffAt/reason) y además fija memory_reset_at y limpia ofertas", async () => {
    pushHappyPath();

    const res = await POST(req({ conversationId: "cv_1" }));

    expect(res.status).toBe(200);
    expect(sendText).not.toHaveBeenCalled();
    expect(clearOffers).toHaveBeenCalledWith("org_1", "cv_1");
    const convUpdate = updates.find((u) => "memoryResetAt" in u);
    expect(convUpdate).toMatchObject({ aiEnabled: true, handoffAt: null, handoffReason: null });
    expect(convUpdate?.memoryResetAt).toBeInstanceOf(Date);
  });

  it("con notice: se manda el aviso ANTES de fijar memory_reset_at", async () => {
    pushHappyPath();

    const res = await POST(req({ conversationId: "cv_1", notice: "Empezamos de nuevo" }));

    expect(res.status).toBe(200);
    expect(sendText).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: "cv_1", text: "Empezamos de nuevo" })
    );
    const convUpdate = updates.find((u) => "memoryResetAt" in u);
    expect(convUpdate).toBeDefined();
    // El orden real de ejecución: el aviso se manda ANTES del update que fija
    // memory_reset_at — así su propio createdAt queda antes del corte.
    expect(order).toEqual(["sendText", "update-memory-reset"]);
  });

  it("el notice se manda con el dispatchId dado (idempotente, seq 0)", async () => {
    pushHappyPath();

    await POST(req({ conversationId: "cv_1", notice: "Hola de nuevo", dispatchId: "dsp_reset_1" }));

    expect(sendText).toHaveBeenCalledWith(
      expect.objectContaining({ dispatchId: "dsp_reset_1", seq: 0, text: "Hola de nuevo" })
    );
  });

  it("el aviso falla (ai_disabled) → 409 ai_paused, y NO llega a fijar memory_reset_at ni a limpiar ofertas", async () => {
    selectQueue.push([CONV]); // solo la conversación: no debería llegar más lejos
    sendText.mockRejectedValueOnce(new SendError("ai_disabled", "La IA fue pausada"));

    const res = await POST(req({ conversationId: "cv_1", notice: "Hola" }));

    expect(res.status).toBe(409);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe("ai_paused");
    expect(clearOffers).not.toHaveBeenCalled();
    expect(updates.some((u) => "memoryResetAt" in u)).toBe(false);
  });

  it("conversación no encontrada → 404, sin tocar sendText/clearOffers", async () => {
    selectQueue.push([]); // no existe

    const res = await POST(req({ conversationId: "cv_missing", notice: "Hola" }));

    expect(res.status).toBe(404);
    expect(sendText).not.toHaveBeenCalled();
    expect(clearOffers).not.toHaveBeenCalled();
  });

  it("clearOffers falla → no revienta el reset (best-effort, igual que el resto de pasos no críticos)", async () => {
    pushHappyPath();
    clearOffers.mockRejectedValueOnce(new Error("boom"));

    const res = await POST(req({ conversationId: "cv_1" }));

    expect(res.status).toBe(200);
  });
});

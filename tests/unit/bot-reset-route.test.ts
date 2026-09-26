import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `POST /api/bot/reset` (dispatch v2).
 *
 * Orden EXACTO (revisado tras un bug real): reactiva (sale del handoff)
 * PRIMERO, manda el `notice` DESPUÉS (ya reactivada — nunca 409 `ai_paused`
 * por el handoff que este mismo reset acaba de limpiar), y solo entonces fija
 * `memory_reset_at` — así el aviso mismo queda ANTES del corte y no vuelve a
 * aparecer en `history` de despachos futuros. Una conversación de prueba
 * (Laboratorio) nunca llama a `sendText`: el aviso se persiste como saliente
 * de prueba, igual que Nea contestando por `/api/bot/messages`. Las ofertas
 * vigentes se limpian. El resto (ficha vaciada, etapa al inicio) sigue igual
 * que antes.
 */

vi.mock("@/server/bot/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/bot/auth")>();
  return { ...actual, resolveInstanceOrg: async () => "org_1" };
});

/** `order`: sella CUÁNDO (en secuencia global) pasó cada evento relevante,
 * para probar "esto pasó ANTES que aquello" sin fake timers ni relojes
 * reales. Todo en `vi.hoisted` porque los `vi.mock` de más abajo se
 * hoistean por encima de cualquier `const` normal. */
const { sendText, persistTestOutbound, order, seal } = vi.hoisted(() => {
  const order: string[] = [];
  const seal = (label: string) => order.push(label);
  return {
    order,
    seal,
    sendText: vi.fn(async () => {
      seal("sendText");
      return { messageId: "msg_aviso" };
    }),
    persistTestOutbound: vi.fn(async (..._args: unknown[]) => {
      seal("persistTestOutbound");
      return { messageId: "msg_aviso_prueba" };
    }),
  };
});
vi.mock("@/server/inbox/send", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/inbox/send")>();
  return { ...actual, sendText };
});
vi.mock("@/server/ai/pipeline", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/ai/pipeline")>();
  return { ...actual, persistTestOutbound };
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
        else if ("aiEnabled" in values) seal("update-reactivate");
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

const CONV = { id: "cv_1", organizationId: "org_1", contactId: "ct_1", isTest: false };
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
    vi.stubEnv("NEA_DISPATCH_URL", "http://nea-agent:8000/dispatch");
    resetRateLimit();
    selectQueue.length = 0;
    updates.length = 0;
    order.length = 0;
    sendText.mockClear();
    persistTestOutbound.mockClear();
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
    const reactivate = updates.find((u) => "aiEnabled" in u);
    expect(reactivate).toMatchObject({ aiEnabled: true, handoffAt: null, handoffReason: null });
    const memoryReset = updates.find((u) => "memoryResetAt" in u);
    expect(memoryReset?.memoryResetAt).toBeInstanceOf(Date);
  });

  it("con notice: reactiva PRIMERO, manda el aviso, y solo entonces fija memory_reset_at", async () => {
    pushHappyPath();

    const res = await POST(req({ conversationId: "cv_1", notice: "Empezamos de nuevo" }));

    expect(res.status).toBe(200);
    expect(sendText).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: "cv_1", text: "Empezamos de nuevo" })
    );
    expect(updates.some((u) => "memoryResetAt" in u)).toBe(true);
    // Orden real de ejecución.
    expect(order).toEqual(["update-reactivate", "sendText", "update-memory-reset"]);
  });

  it("el notice se manda con el dispatchId dado (idempotente, seq 0)", async () => {
    pushHappyPath();

    await POST(req({ conversationId: "cv_1", notice: "Hola de nuevo", dispatchId: "dsp_reset_1" }));

    expect(sendText).toHaveBeenCalledWith(
      expect.objectContaining({ dispatchId: "dsp_reset_1", seq: 0, text: "Hola de nuevo" })
    );
  });

  it("BUG que encontró el revisor: una conversación YA en handoff con notice → se reactiva y el aviso SALE (nunca 409, porque el handoff se limpia ANTES de mandarlo)", async () => {
    selectQueue.push([CONV]); // la propia conversación (isTest:false, sin importar el handoff previo: la ruta no lo lee, solo lo limpia)
    selectQueue.push([CONTACT_ROW]);
    selectQueue.push([]);
    selectQueue.push([]);

    const res = await POST(req({ conversationId: "cv_1", notice: "Seguimos aquí" }));

    expect(res.status).toBe(200);
    expect(sendText).toHaveBeenCalledOnce();
    // La reactivación pasó ANTES del envío — es lo que evita el 409 ai_paused.
    expect(order[0]).toBe("update-reactivate");
    expect(order).toContain("sendText");
  });

  it("conversación de PRUEBA (Laboratorio) con notice → se persiste como saliente de prueba, JAMÁS llama a sendText", async () => {
    selectQueue.push([{ ...CONV, isTest: true }]);
    selectQueue.push([CONTACT_ROW]);
    selectQueue.push([]);
    selectQueue.push([]);

    const res = await POST(
      req({ conversationId: "cv_1", notice: "Reiniciamos la prueba", dispatchId: "dsp_lab_reset" })
    );

    expect(res.status).toBe(200);
    expect(persistTestOutbound).toHaveBeenCalledOnce();
    expect(persistTestOutbound.mock.calls[0]![1]).toBe("Reiniciamos la prueba");
    expect(sendText).not.toHaveBeenCalled();
  });

  it("item 9: el aviso falla (p. ej. fuera de horario) → el reset sigue de todos modos (200, memory_reset_at, ofertas limpias) con noticeSent:false", async () => {
    pushHappyPath();
    sendText.mockRejectedValueOnce(new SendError("outside_hours", "Fuera de horario"));

    const res = await POST(req({ conversationId: "cv_1", notice: "Hola" }));

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; noticeSent: boolean };
    expect(body).toEqual({ ok: true, noticeSent: false });
    // El aviso no salió, pero el RESTO del reset sí terminó — no es best-effort
    // a medias: nada de esto depende de que el aviso haya salido.
    expect(clearOffers).toHaveBeenCalledWith("org_1", "cv_1");
    expect(updates.some((u) => "memoryResetAt" in u)).toBe(true);
    expect(updates.some((u) => "aiEnabled" in u)).toBe(true);
  });

  it("item 9: el aviso SÍ sale → noticeSent:true", async () => {
    pushHappyPath();

    const res = await POST(req({ conversationId: "cv_1", notice: "Hola" }));

    const body = (await res.json()) as { ok: boolean; noticeSent: boolean };
    expect(body).toEqual({ ok: true, noticeSent: true });
  });

  it("item 9: sin notice pedido → noticeSent:false (no había nada que mandar)", async () => {
    pushHappyPath();

    const res = await POST(req({ conversationId: "cv_1" }));

    const body = (await res.json()) as { ok: boolean; noticeSent: boolean };
    expect(body).toEqual({ ok: true, noticeSent: false });
    expect(sendText).not.toHaveBeenCalled();
  });

  it("conversación no encontrada → 404, sin tocar sendText/clearOffers/ningún update", async () => {
    selectQueue.push([]); // no existe

    const res = await POST(req({ conversationId: "cv_missing", notice: "Hola" }));

    expect(res.status).toBe(404);
    expect(sendText).not.toHaveBeenCalled();
    expect(clearOffers).not.toHaveBeenCalled();
    expect(updates).toEqual([]);
  });

  it("clearOffers falla → no revienta el reset (best-effort, igual que el resto de pasos no críticos)", async () => {
    pushHappyPath();
    clearOffers.mockRejectedValueOnce(new Error("boom"));

    const res = await POST(req({ conversationId: "cv_1" }));

    expect(res.status).toBe(200);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Dispatch v2 — `sendText` con `dispatchId`: reserva-primero, idempotente por
 * `(organización, conversación, dispatchId, seq)`. El id es DETERMINISTA
 * (`neaMessageId`), así que dos llamadas con el mismo dispatchId+seq nunca
 * llaman a Graph dos veces, y una falla de Graph borra la reserva para que
 * un reintento pueda volver a intentarlo desde cero.
 */

const { graphRequest } = vi.hoisted(() => ({ graphRequest: vi.fn() }));
vi.mock("@/lib/meta/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/meta/client")>();
  return { ...actual, graphRequest };
});

const { getCredentialsByOrg } = vi.hoisted(() => ({ getCredentialsByOrg: vi.fn() }));
vi.mock("@/server/whatsapp/credentials", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/whatsapp/credentials")>();
  return { ...actual, getCredentialsByOrg };
});

const selectQueue: unknown[][] = [];
/** Tabla `message` real, en memoria — necesaria para simular `ON CONFLICT`. */
const messages = new Map<string, Record<string, unknown>>();
let lastTouchedId: string | null = null;

function readChain(rows: unknown[]) {
  const c: Record<string, unknown> = {};
  for (const m of ["from", "where", "orderBy", "innerJoin", "leftJoin"]) c[m] = () => c;
  c.limit = () => Promise.resolve(rows);
  return c;
}

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => {
      if (selectQueue.length) return readChain(selectQueue.shift()!);
      // Sin cola explícita: la lectura por id que hace `sendTextIdempotent`
      // tras un conflicto de INSERT — el id fue el último que tocó la tabla.
      const row = lastTouchedId ? messages.get(lastTouchedId) : undefined;
      return readChain(row ? [row] : []);
    },
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        const doInsert = () => {
          const id = v.id as string;
          lastTouchedId = id;
          const row = { ...v, createdAt: new Date() };
          messages.set(id, row);
          return row;
        };
        return {
          // Camino de siempre (sin dispatchId): `persistOutbound` no pasa por
          // `onConflictDoNothing`, inserta directo.
          returning: () => Promise.resolve([doInsert()]),
          onConflictDoNothing: () => ({
            returning: () => {
              const id = v.id as string;
              lastTouchedId = id;
              if (messages.has(id)) return Promise.resolve([]);
              return Promise.resolve([doInsert()]);
            },
          }),
        };
      },
    }),
    update: () => ({
      set: (v: Record<string, unknown>) => ({
        where: () => {
          const c: Record<string, unknown> = {};
          c.returning = () => {
            if (lastTouchedId && messages.has(lastTouchedId)) {
              const updated = { ...messages.get(lastTouchedId)!, ...v };
              messages.set(lastTouchedId, updated);
              return Promise.resolve([updated]);
            }
            return Promise.resolve([{ ...v }]);
          };
          (c as { then: unknown }).then = (resolve: (val: unknown) => unknown) => resolve(undefined);
          return c;
        },
      }),
    }),
    delete: () => ({
      where: () => {
        if (lastTouchedId) messages.delete(lastTouchedId);
        return Promise.resolve(undefined);
      },
    }),
  }),
  schema: new Proxy(
    {},
    { get: (_t, tableName) => new Proxy({}, { get: (_t2, col) => `${String(tableName)}.${String(col)}` }) }
  ),
}));

import { neaMessageId } from "@/lib/db/ids";
import { sendText } from "@/server/inbox/send";

function convContactRow(over: Record<string, unknown> = {}) {
  return [
    {
      conversation: {
        id: "cv_1",
        organizationId: "org_1",
        isTest: false,
        channel: "whatsapp",
        aiEnabled: true,
        handoffAt: null,
        lastInboundAt: new Date(),
        ...over,
      },
      contact: { id: "ct_1", phone: "5215511111111", waUserId: null },
    },
  ];
}

const CREDENTIALS = {
  id: "cred_1",
  organizationId: "org_1",
  wabaId: "waba_1",
  phoneNumberId: "pn_1",
  displayPhoneNumber: "+52 55 1111 1111",
  verifiedName: "allok",
  status: "connected" as const,
  token: "token-de-graph-de-prueba",
};

describe("sendText con dispatchId (reserva-primero, idempotente)", () => {
  beforeEach(() => {
    selectQueue.length = 0;
    messages.clear();
    lastTouchedId = null;
    graphRequest.mockReset().mockResolvedValue({ messages: [{ id: "wamid.nuevo" }] });
    getCredentialsByOrg.mockReset().mockResolvedValue(CREDENTIALS);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("mismo dispatchId+seq dos veces → UNA sola llamada a Graph; la segunda responde {messageId, duplicate:true}", async () => {
    selectQueue.push(convContactRow());
    const first = await sendText({
      conversationId: "cv_1",
      organizationId: "org_1",
      text: "hola",
      dispatchId: "dsp_1",
      seq: 0,
    });
    expect(first.duplicate).toBeUndefined();
    expect(graphRequest).toHaveBeenCalledTimes(1);

    selectQueue.push(convContactRow());
    const second = await sendText({
      conversationId: "cv_1",
      organizationId: "org_1",
      text: "hola",
      dispatchId: "dsp_1",
      seq: 0,
    });

    expect(graphRequest).toHaveBeenCalledTimes(1); // sigue en 1: no volvió a llamar a Graph
    expect(second).toEqual({ messageId: first.messageId, duplicate: true });
  });

  it("reserva en vuelo (sin wamid todavía) → 409 send_in_progress, sin llamar a Graph", async () => {
    const id = neaMessageId("org_1", "cv_1", "dsp_en_vuelo", 0);
    messages.set(id, { id, waMessageId: null }); // otro intento la está mandando ahora mismo
    selectQueue.push(convContactRow());

    await expect(
      sendText({
        conversationId: "cv_1",
        organizationId: "org_1",
        text: "hola",
        dispatchId: "dsp_en_vuelo",
        seq: 0,
      })
    ).rejects.toMatchObject({ code: "send_in_progress" });
    expect(graphRequest).not.toHaveBeenCalled();
  });

  it("Graph falla → se borra la reserva (invariante: cero salientes de IA en failed) y un reintento vuelve a mandar", async () => {
    graphRequest.mockRejectedValueOnce(new Error("boom de red"));
    selectQueue.push(convContactRow());

    await expect(
      sendText({
        conversationId: "cv_1",
        organizationId: "org_1",
        text: "hola",
        dispatchId: "dsp_falla",
        seq: 0,
      })
    ).rejects.toThrow();

    const id = neaMessageId("org_1", "cv_1", "dsp_falla", 0);
    expect(messages.has(id)).toBe(false); // la reserva se borró, no quedó `failed`

    // El reintento (mismo dispatchId+seq) encuentra la reserva libre otra vez.
    graphRequest.mockResolvedValueOnce({ messages: [{ id: "wamid.reintento" }] });
    selectQueue.push(convContactRow());
    const retry = await sendText({
      conversationId: "cv_1",
      organizationId: "org_1",
      text: "hola",
      dispatchId: "dsp_falla",
      seq: 0,
    });
    expect(retry.duplicate).toBeUndefined();
    expect(graphRequest).toHaveBeenCalledTimes(2);
  });

  it("dispatchId scoping: la misma dispatchId+seq en otra conversación es un id DISTINTO — no se confunden", async () => {
    selectQueue.push(convContactRow());
    await sendText({
      conversationId: "cv_1",
      organizationId: "org_1",
      text: "hola cv_1",
      dispatchId: "dsp_compartido",
      seq: 0,
    });

    selectQueue.push(convContactRow({ id: "cv_2" }));
    const result = await sendText({
      conversationId: "cv_2",
      organizationId: "org_1",
      text: "hola cv_2",
      dispatchId: "dsp_compartido",
      seq: 0,
    });

    expect(result.duplicate).toBeUndefined();
    expect(graphRequest).toHaveBeenCalledTimes(2); // dos mensajes reales, no un duplicado
  });

  it("distintos `seq` del mismo dispatchId son mensajes DISTINTOS", async () => {
    selectQueue.push(convContactRow());
    const m0 = await sendText({
      conversationId: "cv_1",
      organizationId: "org_1",
      text: "primero",
      dispatchId: "dsp_multi",
      seq: 0,
    });
    selectQueue.push(convContactRow());
    const m1 = await sendText({
      conversationId: "cv_1",
      organizationId: "org_1",
      text: "segundo",
      dispatchId: "dsp_multi",
      seq: 1,
    });

    expect(m0.messageId).not.toBe(m1.messageId);
    expect(graphRequest).toHaveBeenCalledTimes(2);
  });

  it("sin dispatchId sigue el camino de siempre (id aleatorio, sin reserva)", async () => {
    selectQueue.push(convContactRow());
    const result = await sendText({
      conversationId: "cv_1",
      organizationId: "org_1",
      text: "hola normal",
      aiGenerated: true,
    });
    expect(result.messageId).toBeTruthy();
    expect(result.duplicate).toBeUndefined();
    expect(graphRequest).toHaveBeenCalledTimes(1);
  });

  it("conversación de prueba (is_test) + dispatchId → sigue lanzando sandbox_violation, ANTES de reservar nada", async () => {
    selectQueue.push(convContactRow({ isTest: true }));

    await expect(
      sendText({
        conversationId: "cv_1",
        organizationId: "org_1",
        text: "hola",
        dispatchId: "dsp_lab",
        seq: 0,
      })
    ).rejects.toMatchObject({ code: "sandbox_violation" });
    expect(graphRequest).not.toHaveBeenCalled();
  });
});

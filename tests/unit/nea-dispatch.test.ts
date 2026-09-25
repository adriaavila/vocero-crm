import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildNeaPayload,
  dispatchToNea,
  selectMessagesForNea,
  type NeaSourceMessage,
} from "@/server/ai/nea-dispatch";

function msg(overrides: Partial<NeaSourceMessage>): NeaSourceMessage {
  return {
    id: "message_1",
    waMessageId: "wamid.1",
    direction: "in",
    type: "text",
    text: "hola",
    mediaWaId: null,
    timestamp: new Date("2026-09-25T12:00:00.000Z"),
    ...overrides,
  };
}

describe("selectMessagesForNea", () => {
  it("sin saliente previo → todos los entrantes cuentan", () => {
    const all = [
      msg({ id: "m1", direction: "in", text: "hola" }),
      msg({ id: "m2", direction: "in", text: "¿siguen abiertos?" }),
    ];
    expect(selectMessagesForNea(all)).toEqual(all);
  });

  it("solo los entrantes DESPUÉS del último saliente", () => {
    const all = [
      msg({ id: "m1", direction: "in", text: "vieja" }),
      msg({ id: "m2", direction: "out", text: "respuesta anterior" }),
      msg({ id: "m3", direction: "in", text: "nueva 1" }),
      msg({ id: "m4", direction: "in", text: "nueva 2" }),
    ];
    expect(selectMessagesForNea(all).map((m) => m.id)).toEqual(["m3", "m4"]);
  });

  it("nada entrante después del saliente → cae al último entrante (jamás vacío)", () => {
    const all = [
      msg({ id: "m1", direction: "in", text: "vieja" }),
      msg({ id: "m2", direction: "out", text: "respuesta" }),
    ];
    expect(selectMessagesForNea(all).map((m) => m.id)).toEqual(["m1"]);
  });

  it("sin ningún entrante → arreglo vacío", () => {
    expect(selectMessagesForNea([msg({ id: "m1", direction: "out" })])).toEqual([]);
  });
});

describe("buildNeaPayload", () => {
  it("arma el shape exacto del contrato", () => {
    const payload = buildNeaPayload({
      organizationId: "org_1",
      conversationId: "conv_1",
      isTest: false,
      contact: { identity: "5215512345678", name: "Ana" },
      messages: [
        msg({
          id: "m1",
          waMessageId: "wamid.X",
          type: "text",
          text: "hola",
          mediaWaId: null,
          timestamp: new Date("2026-09-25T12:00:00.000Z"),
        }),
      ],
    });

    expect(payload).toEqual({
      organizationId: "org_1",
      conversationId: "conv_1",
      isTest: false,
      contact: { identity: "5215512345678", name: "Ana" },
      messages: [
        {
          id: "wamid.X",
          type: "text",
          text: "hola",
          mediaId: null,
          timestamp: "2026-09-25T12:00:00.000Z",
        },
      ],
    });
  });

  it("mensaje del Laboratorio (sin wa_message_id) → id null", () => {
    const payload = buildNeaPayload({
      organizationId: "org_1",
      conversationId: "conv_lab",
      isTest: true,
      contact: { identity: "bsuid:test", name: "Persona simulada" },
      messages: [msg({ waMessageId: null })],
    });
    expect(payload.messages[0]!.id).toBeNull();
    expect(payload.isTest).toBe(true);
  });

  it("adjunto → mediaId es el media id de Graph, no el asset local", () => {
    const payload = buildNeaPayload({
      organizationId: "org_1",
      conversationId: "conv_1",
      isTest: false,
      contact: { identity: "5215512345678", name: "Ana" },
      messages: [msg({ type: "image", text: null, mediaWaId: "wa_media_123" })],
    });
    expect(payload.messages[0]).toMatchObject({ type: "image", mediaId: "wa_media_123" });
  });
});

describe("dispatchToNea", () => {
  const PAYLOAD = {
    organizationId: "org_1",
    conversationId: "conv_1",
    isTest: false,
    contact: { identity: "5215512345678", name: "Ana" },
    messages: [{ id: "wamid.1", type: "text", text: "hola", mediaId: null, timestamp: "2026-09-25T12:00:00.000Z" }],
  };

  beforeEach(() => {
    vi.stubEnv("NEA_DISPATCH_URL", "http://nea-agent:8000/dispatch");
    vi.stubEnv("BOT_API_KEY", "clave-compartida-con-nea-larga");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("POSTea al NEA_DISPATCH_URL con el body exacto y X-Signature = HMAC-SHA256 de ese mismo body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await dispatchToNea(PAYLOAD);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://nea-agent:8000/dispatch");
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/json");

    const expectedBody = JSON.stringify(PAYLOAD);
    expect(init.body).toBe(expectedBody);
    const expectedSignature = `sha256=${createHmac("sha256", "clave-compartida-con-nea-larga")
      .update(expectedBody)
      .digest("hex")}`;
    expect(init.headers["X-Signature"]).toBe(expectedSignature);
  });

  it("4xx → lanza SIN reintentar (el payload está mal, no la red)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("bad", { status: 422 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(dispatchToNea(PAYLOAD)).rejects.toThrow(/422/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("5xx persistente → reintenta con backoff (~2s, ~5s) y termina lanzando", async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn().mockResolvedValue(new Response("boom", { status: 500 }));
      vi.stubGlobal("fetch", fetchMock);

      const result = dispatchToNea(PAYLOAD);
      const assertion = expect(result).rejects.toThrow(/500/);
      await vi.advanceTimersByTimeAsync(2_000);
      await vi.advanceTimersByTimeAsync(5_000);
      await assertion;

      expect(fetchMock).toHaveBeenCalledTimes(3); // intento + 2 reintentos
    } finally {
      vi.useRealTimers();
    }
  });

  it("timeout / error de red persistente → reintenta y termina lanzando 'Nea no respondió' (no cuelga el turno)", async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi
        .fn()
        .mockRejectedValue(new DOMException("The operation was aborted", "TimeoutError"));
      vi.stubGlobal("fetch", fetchMock);

      const result = dispatchToNea(PAYLOAD);
      const assertion = expect(result).rejects.toThrow(/Nea no respondió/);
      await vi.advanceTimersByTimeAsync(2_000);
      await vi.advanceTimersByTimeAsync(5_000);
      await assertion;

      expect(fetchMock).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("un 5xx que se recupera al reintentar → NO lanza (el reintento salvó el turno)", async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(new Response("boom", { status: 502 }))
        .mockResolvedValueOnce(new Response(null, { status: 200 }));
      vi.stubGlobal("fetch", fetchMock);

      const result = dispatchToNea(PAYLOAD);
      await vi.advanceTimersByTimeAsync(2_000);
      await expect(result).resolves.toBeUndefined();

      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("firma con el BOT_API_KEY recortado (mismo valor que decide isNeaBrain)", async () => {
    vi.stubEnv("BOT_API_KEY", "  clave-compartida-con-nea-larga  ");
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await dispatchToNea(PAYLOAD);

    const [, init] = fetchMock.mock.calls[0]!;
    const expectedBody = JSON.stringify(PAYLOAD);
    const expectedSignature = `sha256=${createHmac("sha256", "clave-compartida-con-nea-larga")
      .update(expectedBody)
      .digest("hex")}`;
    expect(init.headers["X-Signature"]).toBe(expectedSignature);
  });

  it("sin NEA_DISPATCH_URL → lanza sin tocar la red", async () => {
    vi.stubEnv("NEA_DISPATCH_URL", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(dispatchToNea(PAYLOAD)).rejects.toThrow(/NEA_DISPATCH_URL/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

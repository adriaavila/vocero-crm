import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryStore, memoryStoreModule } from "./support/memory-raw-event-store";

/**
 * Data spine — el orquestador del webhook (`receiveWhatsAppWebhook` /
 * `replayRawEvents`) con los procesadores mockeados y la tienda en memoria:
 * qué se guarda, en qué orden se procesa, cómo termina cada evento y qué
 * repite el replay. Las filas reales en Postgres: data-spine-realdb.test.ts.
 */

const mocks = vi.hoisted(() => ({
  processMessagesValue: vi.fn(),
  processEchoesValue: vi.fn(),
  processTemplateStatusValue: vi.fn(),
  processHistoryValue: vi.fn(),
  processSmbAppStateSyncValue: vi.fn(),
  connected: new Map<string, { organizationId: string; wabaId: string; phoneNumberId: string }>(),
}));

vi.mock("@/server/agencia/raw-events-store", () => memoryStoreModule);
vi.mock("@/server/inbox/ingest", () => ({
  processMessagesValue: mocks.processMessagesValue,
  processEchoesValue: mocks.processEchoesValue,
}));
vi.mock("@/server/whatsapp/template-events", () => ({
  processTemplateStatusValue: mocks.processTemplateStatusValue,
}));
vi.mock("@/server/agencia/whatsapp-signup/history-sync", () => ({
  processHistoryValue: mocks.processHistoryValue,
  processSmbAppStateSyncValue: mocks.processSmbAppStateSyncValue,
}));
vi.mock("@/server/whatsapp/credentials", () => ({
  getCredentialsByPhoneNumberId: async (id: string) => mocks.connected.get(id) ?? null,
  getCredentialsByWabaId: async (id: string) =>
    [...mocks.connected.values()].find((c) => c.wabaId === id) ?? null,
  getCredentialsByOrg: async (org: string) =>
    [...mocks.connected.values()].find((c) => c.organizationId === org) ?? null,
}));

import {
  canonicalJson,
  dedupeKeyFor,
  extractChanges,
  jsonbSafe,
  receiveWhatsAppWebhook,
  replayRawEvents,
  safeErrorText,
} from "@/server/agencia/raw-events";

const PN = "PN-1";
const messagesChange = (extra: Record<string, unknown> = {}) => ({
  field: "messages",
  value: { metadata: { phone_number_id: PN }, messages: [{ id: "wamid.1" }], ...extra },
});
const body = (...changes: unknown[]) =>
  JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: "WABA-1", changes }] });

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  memoryStore.reset();
  mocks.connected.clear();
  mocks.connected.set(PN, { organizationId: "org_1", wabaId: "WABA-1", phoneNumberId: PN });
  mocks.processMessagesValue.mockResolvedValue("processed");
  mocks.processEchoesValue.mockResolvedValue("processed");
  mocks.processTemplateStatusValue.mockResolvedValue(undefined);
  mocks.processHistoryValue.mockResolvedValue({ processed: 0, skipped: 0 });
  mocks.processSmbAppStateSyncValue.mockResolvedValue({ processed: 0, skipped: 0 });
});

describe("captura: un raw_event por cambio, ANTES de procesar", () => {
  it("guarda el cambio tal como llegó, ya enrutado, y lo deja processed", async () => {
    let seenAtProcessTime: string | undefined;
    mocks.processMessagesValue.mockImplementationOnce(async () => {
      seenAtProcessTime = memoryStore.rows[0]?.status;
      return "processed";
    });

    const result = await receiveWhatsAppWebhook(body(messagesChange()));

    expect(result).toEqual({ retry: false });
    expect(seenAtProcessTime).toBe("pending"); // ya estaba guardado al procesar
    expect(memoryStore.rows).toHaveLength(1);
    expect(memoryStore.rows[0]).toMatchObject({
      channel: "whatsapp",
      organizationId: "org_1",
      accountRef: PN,
      field: "messages",
      status: "processed",
      attempts: 1,
      error: null,
      payload: { entryId: "WABA-1", field: "messages", value: messagesChange().value },
    });
    expect(memoryStore.rows[0]!.processedAt).toBeInstanceOf(Date);
    // El procesador recibe el id del evento para estamparlo en el mensaje.
    expect(mocks.processMessagesValue).toHaveBeenCalledWith(expect.anything(), {
      rawEventId: memoryStore.rows[0]!.id,
    });
  });

  it("webhook duplicado: el segundo POST idéntico no vuelve a procesar", async () => {
    await receiveWhatsAppWebhook(body(messagesChange()));
    await receiveWhatsAppWebhook(body(messagesChange()));

    expect(mocks.processMessagesValue).toHaveBeenCalledTimes(1);
    expect(memoryStore.rows).toHaveLength(1);
    expect(memoryStore.rows[0]!.attempts).toBe(1);
  });

  it("el mismo cambio dos veces dentro de UN POST se procesa una sola vez", async () => {
    await receiveWhatsAppWebhook(body(messagesChange(), messagesChange()));
    expect(mocks.processMessagesValue).toHaveBeenCalledTimes(1);
  });

  it("reintento tras un fallo: failed → processed, attempts=2, y el POST pide 503 solo la primera vez", async () => {
    mocks.processMessagesValue.mockRejectedValueOnce(new Error("db down"));

    const first = await receiveWhatsAppWebhook(body(messagesChange()));
    expect(first).toEqual({ retry: true });
    expect(memoryStore.rows[0]).toMatchObject({ status: "failed", attempts: 1 });
    expect(memoryStore.rows[0]!.error).toContain("db down");

    const second = await receiveWhatsAppWebhook(body(messagesChange())); // Meta reintenta
    expect(second).toEqual({ retry: false });
    expect(memoryStore.rows).toHaveLength(1);
    expect(memoryStore.rows[0]).toMatchObject({ status: "processed", attempts: 2, error: null });
    expect(mocks.processMessagesValue).toHaveBeenCalledTimes(2);
  });

  it("un campo desconocido se guarda y queda ignored, sin procesarse", async () => {
    const result = await receiveWhatsAppWebhook(
      body({ field: "account_update", value: { event: "VERIFIED_ACCOUNT" } })
    );

    expect(result).toEqual({ retry: false });
    expect(memoryStore.rows[0]).toMatchObject({ field: "account_update", status: "ignored", attempts: 1 });
    expect(mocks.processMessagesValue).not.toHaveBeenCalled();
  });

  it("un cambio sin `field` se guarda como `unknown`", async () => {
    await receiveWhatsAppWebhook(body({ value: { x: 1 } }));
    expect(memoryStore.rows[0]).toMatchObject({ field: "unknown", status: "ignored" });
  });

  it("cuerpo ilegible con firma válida: se guarda como `_unparsed` failed y NO pide reintento", async () => {
    const result = await receiveWhatsAppWebhook("{esto no es json");

    expect(result).toEqual({ retry: false });
    expect(memoryStore.rows).toHaveLength(1);
    expect(memoryStore.rows[0]).toMatchObject({
      field: "_unparsed",
      status: "failed",
      error: "invalid_json",
      organizationId: null,
      payload: { body: "{esto no es json" },
    });
  });

  it("JSON válido sin cambios: se guarda como `_unparsed` ignored", async () => {
    await receiveWhatsAppWebhook(JSON.stringify({ object: "whatsapp_business_account" }));
    expect(memoryStore.rows[0]).toMatchObject({ field: "_unparsed", status: "ignored", error: "no_changes" });
  });

  it("messages se procesa ANTES que history aunque llegue después, y un fallo de uno no frena al otro", async () => {
    const order: string[] = [];
    mocks.processMessagesValue.mockImplementation(async () => {
      order.push("messages");
      return "processed";
    });
    mocks.processHistoryValue.mockImplementation(async () => {
      order.push("history");
      throw new Error("conexión perdida");
    });
    mocks.processSmbAppStateSyncValue.mockImplementation(async () => {
      order.push("smb_app_state_sync");
      return { processed: 0, skipped: 0 };
    });
    const withPn = { metadata: { phone_number_id: PN } };

    const result = await receiveWhatsAppWebhook(
      body(
        { field: "history", value: withPn },
        { field: "smb_app_state_sync", value: withPn },
        { field: "messages", value: withPn }
      )
    );

    expect(order).toEqual(["messages", "history", "smb_app_state_sync"]);
    expect(result).toEqual({ retry: true });
    expect(memoryStore.byField("history")[0]).toMatchObject({ status: "failed" });
    expect(memoryStore.byField("smb_app_state_sync")[0]).toMatchObject({ status: "processed" });
  });

  it("un echo que falla queda failed (replayable) pero NO pide reintento: un echo malformado no puede tumbar el webhook", async () => {
    mocks.processEchoesValue.mockResolvedValueOnce("failed");

    const result = await receiveWhatsAppWebhook(
      body({ field: "smb_message_echoes", value: { metadata: { phone_number_id: PN } } })
    );

    expect(result).toEqual({ retry: false });
    expect(memoryStore.rows[0]).toMatchObject({ status: "failed", error: "echo_ingest_failed" });
  });

  it("si guardar el evento falla, igual se procesa (perder la copia cruda es mejor que dejar de atender)", async () => {
    memoryStore.failNextInsert = true;

    const result = await receiveWhatsAppWebhook(body(messagesChange()));

    expect(result).toEqual({ retry: false });
    expect(mocks.processMessagesValue).toHaveBeenCalledWith(expect.anything(), { rawEventId: undefined });
  });

  it("jsonb: se quitan los NUL y los sustitutos sueltos, que harían fallar el INSERT para siempre", async () => {
    await receiveWhatsAppWebhook(
      body({
        field: "messages",
        value: { metadata: { phone_number_id: PN }, messages: [{ text: { body: "hola\u0000 mundo\uD800" } }] },
      })
    );
    const stored = JSON.stringify(memoryStore.rows[0]!.payload);
    expect(stored).not.toContain("\\u0000");
    expect(stored).toContain("hola mundo�");
  });
});

describe("enrutado: unrouted y unmatched se guardan para el replay", () => {
  it("phone_number_id desconocido → unrouted, sin llamar al procesador; tras conectar el número, replay → processed con su organización", async () => {
    mocks.connected.clear();

    const result = await receiveWhatsAppWebhook(body(messagesChange()));
    expect(result).toEqual({ retry: false });
    expect(mocks.processMessagesValue).not.toHaveBeenCalled();
    expect(memoryStore.rows[0]).toMatchObject({
      status: "unrouted",
      organizationId: null,
      accountRef: PN,
      attempts: 1,
    });

    // Sin cambios, el replay vuelve a dejarlo unrouted (y cuenta otro intento).
    const idle = await replayRawEvents();
    expect(idle).toMatchObject({ scanned: 1, unrouted: 1, processed: 0 });

    mocks.connected.set(PN, { organizationId: "org_9", wabaId: "WABA-9", phoneNumberId: PN });
    const summary = await replayRawEvents();

    expect(summary).toMatchObject({ scanned: 1, processed: 1, unrouted: 0 });
    expect(memoryStore.rows[0]).toMatchObject({ status: "processed", organizationId: "org_9", attempts: 3 });
    expect(mocks.processMessagesValue).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ rawEventId: memoryStore.rows[0]!.id, replay: true })
    );
  });

  it("un messages sin phone_number_id no se puede enrutar → unrouted", async () => {
    await receiveWhatsAppWebhook(body({ field: "messages", value: { messages: [{ id: "x" }] } }));
    expect(memoryStore.rows[0]).toMatchObject({ status: "unrouted", accountRef: null });
  });

  it("estado de un wamid desconocido → unmatched; el replay lo cierra cuando el mensaje ya existe", async () => {
    mocks.processMessagesValue.mockResolvedValueOnce("unmatched");
    const status = { metadata: { phone_number_id: PN }, statuses: [{ id: "wamid.9", status: "sent", timestamp: "1" }] };

    const result = await receiveWhatsAppWebhook(body({ field: "messages", value: status }));
    expect(result).toEqual({ retry: false });
    expect(memoryStore.rows[0]).toMatchObject({ status: "unmatched", organizationId: "org_1", attempts: 1 });

    const summary = await replayRawEvents(); // el mensaje ya se guardó
    expect(summary).toMatchObject({ scanned: 1, processed: 1, unmatched: 0 });
    expect(memoryStore.rows[0]).toMatchObject({ status: "processed", attempts: 2 });
  });

  it("los eventos de plantilla se enrutan por el WABA de entry.id", async () => {
    await receiveWhatsAppWebhook(
      body({ field: "message_template_status_update", value: { event: "APPROVED" } })
    );
    expect(memoryStore.rows[0]).toMatchObject({ status: "processed", organizationId: "org_1", accountRef: "WABA-1" });
    expect(mocks.processTemplateStatusValue).toHaveBeenCalledWith("WABA-1", { event: "APPROVED" }, {});
  });
});

describe("replay", () => {
  it("por default repite failed / unrouted / unmatched y deja en paz processed, ignored y _unparsed", async () => {
    mocks.processMessagesValue.mockRejectedValueOnce(new Error("boom"));
    await receiveWhatsAppWebhook(body(messagesChange({ messages: [{ id: "wamid.a" }] })));
    await receiveWhatsAppWebhook(body(messagesChange({ messages: [{ id: "wamid.b" }] })));
    await receiveWhatsAppWebhook(body({ field: "account_update", value: { a: 1 } }));
    await receiveWhatsAppWebhook("no json");
    expect(memoryStore.rows.map((r) => r.status)).toEqual(["failed", "processed", "ignored", "failed"]);

    const summary = await replayRawEvents();

    expect(summary).toMatchObject({ scanned: 1, processed: 1, failed: 0 });
    expect(memoryStore.rows.map((r) => r.status)).toEqual(["processed", "processed", "ignored", "failed"]);
  });

  it("un procesador que vuelve a fallar en el replay no lanza: queda failed y se cuenta", async () => {
    mocks.processMessagesValue.mockRejectedValue(new Error("sigue caído"));
    await receiveWhatsAppWebhook(body(messagesChange()));

    const summary = await replayRawEvents();

    expect(summary).toMatchObject({ scanned: 1, failed: 1, processed: 0 });
    expect(memoryStore.rows[0]).toMatchObject({ status: "failed", attempts: 2 });
  });

  it("con organizationId recoge también lo SIN enrutar de su número, y nada de otra organización", async () => {
    mocks.connected.clear();
    await receiveWhatsAppWebhook(body(messagesChange())); // unrouted, account_ref PN-1
    await receiveWhatsAppWebhook(
      body({ field: "messages", value: { metadata: { phone_number_id: "PN-OTRO" }, messages: [{ id: "z" }] } })
    );
    mocks.connected.set(PN, { organizationId: "org_9", wabaId: "WABA-9", phoneNumberId: PN });

    const summary = await replayRawEvents({ organizationId: "org_9" });

    expect(summary).toMatchObject({ scanned: 1, processed: 1 });
    expect(memoryStore.rows.map((r) => r.status)).toEqual(["processed", "unrouted"]);
  });

  it("respeta `limit` y los `statuses` pedidos", async () => {
    mocks.connected.clear();
    for (const id of ["a", "b", "c"]) {
      await receiveWhatsAppWebhook(body(messagesChange({ messages: [{ id }] })));
    }
    mocks.connected.set(PN, { organizationId: "org_1", wabaId: "WABA-1", phoneNumberId: PN });

    expect(await replayRawEvents({ statuses: ["failed"] })).toMatchObject({ scanned: 0 });
    expect(await replayRawEvents({ limit: 2 })).toMatchObject({ scanned: 2, processed: 2 });
    expect(memoryStore.rows.map((r) => r.status)).toEqual(["processed", "processed", "unrouted"]);
  });
});

describe("replay: nunca le escribe al cliente ni mueve el pasado", () => {
  it("el replay marca `replay: true` (y cuándo llegó el evento) a messages y echoes; la entrega en vivo NO", async () => {
    const withPn = { metadata: { phone_number_id: PN } };
    mocks.processMessagesValue.mockRejectedValueOnce(new Error("boom"));
    mocks.processEchoesValue.mockResolvedValueOnce("failed");
    await receiveWhatsAppWebhook(body(messagesChange(), { field: "smb_message_echoes", value: withPn }));
    // En vivo: sin `replay`.
    expect(mocks.processMessagesValue.mock.calls[0]![1]).toEqual({ rawEventId: "rev_mem1" });
    expect(mocks.processEchoesValue.mock.calls[0]![1]).toEqual({ rawEventId: "rev_mem2" });

    await replayRawEvents();

    const liveReceivedAt = memoryStore.rows[0]!.receivedAt;
    expect(mocks.processMessagesValue.mock.calls[1]![1]).toEqual({
      rawEventId: "rev_mem1",
      replay: true,
      receivedAt: liveReceivedAt,
    });
    expect(mocks.processEchoesValue.mock.calls[1]![1]).toMatchObject({ replay: true });
  });

  it("un evento de plantilla en replay solo se aplica si nada cambió la plantilla después de que llegó (notAfter)", async () => {
    mocks.processTemplateStatusValue.mockRejectedValueOnce(new Error("boom"));
    await receiveWhatsAppWebhook(
      body({ field: "message_template_status_update", value: { event: "APPROVED" } })
    );
    await replayRawEvents();
    expect(mocks.processTemplateStatusValue).toHaveBeenLastCalledWith(
      "WABA-1",
      { event: "APPROVED" },
      { notAfter: memoryStore.rows[0]!.receivedAt }
    );
  });

  it("un fallo en el replay no pide reintento a nadie y deja el evento failed", async () => {
    mocks.processMessagesValue.mockRejectedValue(new Error("sigue"));
    await receiveWhatsAppWebhook(body(messagesChange()));
    const summary = await replayRawEvents();
    expect(summary.failed).toBe(1);
    expect(memoryStore.rows[0]).toMatchObject({ status: "failed", attempts: 2 });
  });
});

describe("veneno: tras 3 intentos fallidos se responde 200 y el evento queda failed", () => {
  it("503, 503, 200 (el 3º intento agota los intentos); un 4º POST ni lo procesa", async () => {
    mocks.processMessagesValue.mockRejectedValue(new Error("siempre falla"));
    const raw = body(messagesChange());

    expect(await receiveWhatsAppWebhook(raw)).toEqual({ retry: true }); // attempts 1
    expect(await receiveWhatsAppWebhook(raw)).toEqual({ retry: true }); // attempts 2
    expect(await receiveWhatsAppWebhook(raw)).toEqual({ retry: false }); // attempts 3: Meta lo suelta
    expect(memoryStore.rows[0]).toMatchObject({ status: "failed", attempts: 3 });
    expect(mocks.processMessagesValue).toHaveBeenCalledTimes(3);

    expect(await receiveWhatsAppWebhook(raw)).toEqual({ retry: false });
    expect(mocks.processMessagesValue).toHaveBeenCalledTimes(3); // sin procesar
    expect(memoryStore.rows[0]).toMatchObject({ status: "failed", attempts: 3 });
  });

  it("sigue replayable: el replay lo procesa aunque ya no se le pida nada a Meta", async () => {
    mocks.processMessagesValue.mockRejectedValue(new Error("siempre falla"));
    const raw = body(messagesChange());
    for (let i = 0; i < 3; i++) await receiveWhatsAppWebhook(raw);
    mocks.processMessagesValue.mockResolvedValue("processed");

    const summary = await replayRawEvents();

    expect(summary).toMatchObject({ scanned: 1, processed: 1 });
    expect(memoryStore.rows[0]).toMatchObject({ status: "processed", attempts: 4 });
  });

  it("un veneno no frena a los demás cambios del mismo POST, que se procesan y no piden reintento", async () => {
    const withPn = { metadata: { phone_number_id: PN } };
    mocks.processHistoryValue.mockRejectedValue(new Error("veneno"));
    const raw = body({ field: "history", value: withPn }, messagesChange());
    await receiveWhatsAppWebhook(raw);
    await receiveWhatsAppWebhook(raw);
    const third = await receiveWhatsAppWebhook(raw);

    expect(third).toEqual({ retry: false });
    expect(memoryStore.byField("messages")[0]).toMatchObject({ status: "processed", attempts: 1 });
    expect(mocks.processMessagesValue).toHaveBeenCalledTimes(1);
  });

  it("sin fila (falló guardar) no hay cuenta de intentos: se sigue pidiendo reintento", async () => {
    mocks.processMessagesValue.mockRejectedValue(new Error("boom"));
    memoryStore.failNextInsert = true;
    expect(await receiveWhatsAppWebhook(body(messagesChange()))).toEqual({ retry: true });
  });
});

describe("NUL: los procesadores reciben el valor ya limpio", () => {
  it("texto, nombre y caption sin \u0000; la llave de dedupe sigue siendo la del cambio original", async () => {
    const value = {
      metadata: { phone_number_id: PN },
      contacts: [{ profile: { name: "Ana\u0000 Pérez" }, wa_id: "58412" }],
      messages: [
        { id: "w1", type: "text", text: { body: "ho\u0000la" } },
        { id: "w2", type: "image", image: { id: "m1", caption: "foto\u0000 buena" } },
        { id: "w3", type: "location", location: { latitude: 1, longitude: 2, name: "Ofi\u0000cina" } },
      ],
    };

    await receiveWhatsAppWebhook(body({ field: "messages", value }));

    const seen = mocks.processMessagesValue.mock.calls[0]![0] as typeof value;
    expect(JSON.stringify(seen)).not.toContain("\\u0000");
    expect(seen.contacts[0]!.profile.name).toBe("Ana Pérez");
    expect(seen.messages[0]!.text!.body).toBe("hola");
    expect(seen.messages[1]!.image!.caption).toBe("foto buena");
    expect(seen.messages[2]!.location!.name).toBe("Oficina");
    expect(memoryStore.rows[0]!.dedupeKey).toBe(dedupeKeyFor("messages", value));
  });
});

describe("replay: orden justo", () => {
  it("los eventos menos intentados van primero: unmatched que nunca coinciden no dejan sin turno al lote", async () => {
    // 3 viejos que ya se intentaron muchas veces y no coinciden; luego 2 nuevos.
    for (const id of ["old1", "old2", "old3", "new1", "new2"]) {
      mocks.processMessagesValue.mockResolvedValueOnce("unmatched");
      await receiveWhatsAppWebhook(body(messagesChange({ messages: [{ id }] })));
    }
    for (const row of memoryStore.rows.slice(0, 3)) row.attempts = 9;
    mocks.processMessagesValue.mockImplementation(async (v: { messages: { id: string }[] }) =>
      v.messages[0]!.id.startsWith("new") ? "processed" : "unmatched"
    );

    const summary = await replayRawEvents({ limit: 2 });

    expect(summary).toMatchObject({ scanned: 2, processed: 2, unmatched: 0 });
    expect(memoryStore.rows.map((r) => r.status)).toEqual([
      "unmatched", "unmatched", "unmatched", "processed", "processed",
    ]);
    // El siguiente lote retoma a los viejos (nadie queda fuera para siempre).
    expect(await replayRawEvents({ limit: 5 })).toMatchObject({ scanned: 3, unmatched: 3 });
  });
});

describe("utilidades puras", () => {
  it("canonicalJson ordena las llaves: el mismo cambio da la misma llave de dedupe", () => {
    expect(canonicalJson({ b: 1, a: { d: [2, { z: 1, y: 2 }], c: null } })).toBe(
      '{"a":{"c":null,"d":[2,{"y":2,"z":1}]},"b":1}'
    );
    expect(dedupeKeyFor("messages", { a: 1, b: 2 })).toBe(dedupeKeyFor("messages", { b: 2, a: 1 }));
  });

  it("la llave de dedupe depende del field y del contenido", () => {
    expect(dedupeKeyFor("messages", { a: 1 })).not.toBe(dedupeKeyFor("history", { a: 1 }));
    expect(dedupeKeyFor("messages", { a: 1 })).not.toBe(dedupeKeyFor("messages", { a: 2 }));
    expect(dedupeKeyFor("messages", { a: 1 })).toMatch(/^[0-9a-f]{64}$/);
  });

  it("extractChanges aplana entry[].changes[] en orden y tolera formas raras", () => {
    expect(
      extractChanges({
        entry: [
          { id: "W1", changes: [{ field: "a", value: { x: 1 } }, { value: null }] },
          { changes: "no es un arreglo" },
          null,
        ],
      })
    ).toEqual([
      { entryId: "W1", field: "a", value: { x: 1 } },
      { entryId: "W1", field: "unknown", value: null },
    ]);
    expect(extractChanges(null)).toEqual([]);
    expect(extractChanges([])).toEqual([]);
  });

  it("jsonbSafe solo toca NUL y sustitutos sueltos, también en llaves y anidados", () => {
    expect(jsonbSafe({ "a\u0000": ["x\u0000y", { ok: "ñandú 👍" }], n: 1 })).toEqual({
      a: ["xy", { ok: "ñandú 👍" }],
      n: 1,
    });
  });

  it("safeErrorText: nombre, código y primera línea; de un error de Drizzle solo la causa (sin SQL ni parámetros)", () => {
    const driver = Object.assign(new Error('relation "raw_event" does not exist'), {
      name: "PostgresError",
      code: "42P01",
    });
    const wrapped = new Error('Failed query: insert into "message" (text) values ($1)\nparams: hola secreto', {
      cause: driver,
    });
    const text = safeErrorText(wrapped);
    expect(text).toBe('PostgresError 42P01: relation "raw_event" does not exist');
    expect(text).not.toContain("secreto");

    expect(safeErrorText("texto")).toBe("unknown_error");
    expect(safeErrorText(new Error("x".repeat(500))).length).toBeLessThanOrEqual(200);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Respuestas a botones: tocar una respuesta rápida de plantilla (`button`) o
 * un botón / fila de lista de un mensaje interactivo (`interactive`) es un
 * mensaje real del cliente. Antes la ingesta los descartaba: no aparecían en
 * el inbox, no abrían la ventana de 24 h y no disparaban al agente.
 *
 * Los payloads son los ejemplos de la referencia de webhooks de Meta
 * (messages → button / interactive), copiados tal cual.
 */

const { maybeRunAgentTurn, publish } = vi.hoisted(() => ({
  maybeRunAgentTurn: vi.fn(),
  publish: vi.fn(),
}));

/** BD en memoria estilo Drizzle: filas por tabla; `where` se ignora. */
const tables = new Map<unknown, Record<string, unknown>[]>();
function rowsOf(table: unknown): Record<string, unknown>[] {
  if (!tables.has(table)) tables.set(table, []);
  return tables.get(table)!;
}
function query(rows: () => unknown[]) {
  const chain: Record<string, unknown> = {
    then: (resolve: (value: unknown[]) => unknown, reject: (error: unknown) => unknown) =>
      Promise.resolve().then(rows).then(resolve, reject),
  };
  for (const step of ["where", "limit", "returning", "onConflictDoNothing"]) {
    chain[step] = () => chain;
  }
  return chain;
}
const db = {
  select: () => ({ from: (table: unknown) => query(() => rowsOf(table)) }),
  insert: (table: unknown) => ({
    values: (value: Record<string, unknown>) => {
      rowsOf(table).push(value);
      return query(() => [value]);
    },
  }),
  update: (table: unknown) => ({
    set: (patch: Record<string, unknown>) =>
      query(() => rowsOf(table).map((row) => Object.assign(row, patch))),
  }),
};

vi.mock("@/lib/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db")>()),
  getDb: () => db,
}));
vi.mock("@/server/whatsapp/credentials", () => ({
  getCredentialsByPhoneNumberId: async () => ({ organizationId: "org_1" }),
}));
vi.mock("@/server/inbox/identity", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/inbox/identity")>()),
  getOrCreateContactByIdentity: async () => ({
    contact: { id: "contact_1", channel: "whatsapp" },
    isNew: true,
  }),
}));
vi.mock("@/server/agencia/ia-inicial", () => ({ iaInicialPara: async () => true }));
vi.mock("@/server/inbox/lead-activity", () => ({ onLeadActivity: vi.fn() }));
vi.mock("@/server/events/bus", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/events/bus")>()),
  publish,
}));
vi.mock("@/server/ai/trigger", () => ({ maybeRunAgentTurn }));

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { schema } from "@/lib/db";
import type { MessageDto } from "@/lib/types";
import { inboundText, processMessagesValue } from "@/server/inbox/ingest";
import type { WebhookMessage, WebhookValue } from "@/server/inbox/webhook";
import { isWindowOpen } from "@/server/inbox/window";
import { MessageThread } from "@/components/inbox/message-thread";

const QUICK_REPLY_WEBHOOK = {
  object: "whatsapp_business_account",
  entry: [
    {
      id: "102290129340398",
      changes: [
        {
          value: {
            messaging_product: "whatsapp",
            metadata: {
              display_phone_number: "15550783881",
              phone_number_id: "106540352242922",
            },
            contacts: [{ profile: { name: "Sheena Nelson" }, wa_id: "16505551234" }],
            messages: [
              {
                context: {
                  from: "15550783881",
                  id: "wamid.HBgLMTQxMjU1NTA4MjkVAgASGBQzQUNCNjk5RDUwNUZGMUZEM0VBRAA=",
                },
                from: "16505551234",
                id: "wamid.HBgLMTY1MDM4Nzk0MzkVAgASGBQzQUFERjg0NDEzNDdFODU3MUMxMAA=",
                timestamp: "1750091045",
                type: "button",
                button: { payload: "Unsubscribe", text: "Unsubscribe" },
              },
            ],
          },
          field: "messages",
        },
      ],
    },
  ],
};

const LIST_REPLY_WEBHOOK = {
  object: "whatsapp_business_account",
  entry: [
    {
      id: "102290129340398",
      changes: [
        {
          value: {
            messaging_product: "whatsapp",
            metadata: {
              display_phone_number: "15550783881",
              phone_number_id: "106540352242922",
            },
            contacts: [{ profile: { name: "Sheena Nelson" }, wa_id: "16505551234" }],
            messages: [
              {
                context: {
                  from: "15550783881",
                  id: "wamid.HBgLMTQxMjU1NTA4MjkVAgASGBQzQUNCNjk5RDUwNUZGMUZEM0VBRAA=",
                },
                from: "16505551234",
                id: "wamid.HBgLMTY1MDM4Nzk0MzkVAgASGBQzQUFERjg0NDEzNDdFODU3MUMxMAA=",
                timestamp: "1749854575",
                type: "interactive",
                interactive: {
                  type: "list_reply",
                  list_reply: {
                    id: "priority_express",
                    title: "Priority Mail Express",
                    description: "Next Day to 2 Days",
                  },
                },
              },
            ],
          },
          field: "messages",
        },
      ],
    },
  ],
};

const BUTTON_REPLY_WEBHOOK = {
  object: "whatsapp_business_account",
  entry: [
    {
      id: "102290129340398",
      changes: [
        {
          value: {
            messaging_product: "whatsapp",
            metadata: {
              display_phone_number: "15550783881",
              phone_number_id: "106540352242922",
            },
            contacts: [{ profile: { name: "Sheena Nelson" }, wa_id: "16505551234" }],
            messages: [
              {
                context: {
                  from: "15550783881",
                  id: "wamid.HBgLMTY1MDM4Nzk0MzkVAgARGBI3MEM2RUJFNkI0RENGQTVDRjUA",
                },
                from: "16505551234",
                id: "wamid.HBgLMTY1MDM4Nzk0MzkVAgASGBQzQTZBQzg0MzQ4QjRCM0NGNkVGOAA=",
                timestamp: "1750025136",
                type: "interactive",
                interactive: {
                  type: "button_reply",
                  button_reply: { id: "cancel-button", title: "Cancel" },
                },
              },
            ],
          },
          field: "messages",
        },
      ],
    },
  ],
};

/** Producto del catálogo: también es `interactive`, pero no es respuesta a un botón. */
const PRODUCT_WEBHOOK = {
  object: "whatsapp_business_account",
  entry: [
    {
      id: "102290129340398",
      changes: [
        {
          value: {
            messaging_product: "whatsapp",
            metadata: {
              display_phone_number: "15550783881",
              phone_number_id: "106540352242922",
            },
            contacts: [{ profile: { name: "Sheena Nelson" }, wa_id: "16505551234" }],
            messages: [
              {
                from: "16505551234",
                id: "wamid.HBgLMTY1MDM4Nzk0MzkVAgASGBQzQTZBQzg0MzQ4QjRCM0NGNkVGOAA=",
                timestamp: "1750025136",
                type: "interactive",
                interactive: {
                  type: "product",
                  product: {
                    retailer_id: "2lc20305pt",
                    title: "Classic T-Shirt",
                    description: "100% cotton, unisex fit",
                    currency_code: "USD",
                    price_amount: 1000,
                    sale_price_amount: 800,
                    url: "https://example.com/products/classic-t-shirt",
                  },
                },
              },
            ],
          },
          field: "messages",
        },
      ],
    },
  ],
};

/**
 * Respuesta de un WhatsApp Flow (`nfm_reply`): la estructura de la guía de
 * webhooks de Flows de Meta, con valores concretos en lugar de placeholders.
 */
const FLOW_REPLY_WEBHOOK = {
  object: "whatsapp_business_account",
  entry: [
    {
      id: "102290129340398",
      changes: [
        {
          value: {
            messaging_product: "whatsapp",
            metadata: {
              display_phone_number: "15550783881",
              phone_number_id: "106540352242922",
            },
            contacts: [{ profile: { name: "Sheena Nelson" }, wa_id: "16505551234" }],
            messages: [
              {
                context: { from: "16315558151", id: "gBGGEiRVVgBPAgm7FUgc73noXjo" },
                from: "16505551234",
                id: "wamid.flow.response.1",
                type: "interactive",
                interactive: {
                  type: "nfm_reply",
                  nfm_reply: {
                    name: "flow",
                    body: "Sent",
                    response_json: '{"flow_token": "tok_1", "optional_param1": "a"}',
                  },
                },
                timestamp: "1750025136",
              },
            ],
          },
          field: "messages",
        },
      ],
    },
  ],
};

type Webhook = { entry: { changes: { value: WebhookValue }[] }[] };
const valueOf = (webhook: Webhook): WebhookValue => webhook.entry[0]!.changes[0]!.value;
const messageOf = (webhook: Webhook): WebhookMessage => valueOf(webhook).messages![0]!;

describe("inboundText: texto legible de una respuesta a botón", () => {
  it("respuesta rápida de plantilla → la etiqueta del botón", () => {
    expect(inboundText(messageOf(QUICK_REPLY_WEBHOOK))).toBe("Unsubscribe");
  });

  it("botón de mensaje interactivo → su título", () => {
    expect(inboundText(messageOf(BUTTON_REPLY_WEBHOOK))).toBe("Cancel");
  });

  it("fila de lista → título y descripción", () => {
    expect(inboundText(messageOf(LIST_REPLY_WEBHOOK))).toBe(
      "Priority Mail Express\nNext Day to 2 Days"
    );
  });

  it("fila de lista sin descripción → solo el título", () => {
    const msg = messageOf(LIST_REPLY_WEBHOOK);
    expect(
      inboundText({
        ...msg,
        interactive: { type: "list_reply", list_reply: { id: "a", title: "Mañana" } },
      })
    ).toBe("Mañana");
  });

  it("interactive sin respuesta legible (producto, Flow) → null", () => {
    expect(inboundText(messageOf(PRODUCT_WEBHOOK))).toBeNull();
    expect(inboundText(messageOf(FLOW_REPLY_WEBHOOK))).toBeNull();
  });

  it("texto y adjuntos siguen igual", () => {
    const base = { id: "wamid.x", timestamp: "1750000000" };
    expect(inboundText({ ...base, type: "text", text: { body: "hola" } })).toBe("hola");
    expect(inboundText({ ...base, type: "image", image: { id: "media1" } })).toBeNull();
  });
});

describe("processMessagesValue: una respuesta a botón es un entrante real", () => {
  beforeEach(() => {
    tables.clear();
    vi.clearAllMocks();
  });

  it.each([
    ["button", QUICK_REPLY_WEBHOOK, "Unsubscribe"],
    ["interactive", BUTTON_REPLY_WEBHOOK, "Cancel"],
    ["interactive", LIST_REPLY_WEBHOOK, "Priority Mail Express\nNext Day to 2 Days"],
  ] as const)(
    "%s → mensaje entrante con texto, ventana abierta y turno del agente (%#)",
    async (type, webhook, text) => {
      const incoming = messageOf(webhook);
      await processMessagesValue(valueOf(webhook));

      expect(rowsOf(schema.message)).toEqual([
        expect.objectContaining({
          organizationId: "org_1",
          waMessageId: incoming.id,
          direction: "in",
          type,
          text,
        }),
      ]);

      // Ventana de 24 h: cuenta desde el tap, igual que un texto.
      const sentAt = new Date(Number(incoming.timestamp) * 1000);
      const conversation = rowsOf(schema.conversation)[0]!;
      const lastInboundAt = conversation.lastInboundAt as Date;
      expect(lastInboundAt).toEqual(sentAt);
      expect(isWindowOpen(lastInboundAt, new Date(sentAt.getTime() + 60_000))).toBe(true);

      // Aparece en el inbox en vivo y dispara al agente (Nea o Rei).
      expect(publish).toHaveBeenCalledWith(
        "org_1",
        expect.objectContaining({
          type: "message.new",
          data: expect.objectContaining({
            message: expect.objectContaining({ direction: "in", type, text }),
          }),
        })
      );
      expect(maybeRunAgentTurn).toHaveBeenCalledWith(conversation.id, "org_1");
    }
  );

  it.each([
    ["producto", PRODUCT_WEBHOOK],
    ["Flow", FLOW_REPLY_WEBHOOK],
  ] as const)("un interactive sin respuesta legible (%s) se sigue ignorando", async (_, webhook) => {
    await processMessagesValue(valueOf(webhook));

    expect(rowsOf(schema.message)).toEqual([]);
    expect(maybeRunAgentTurn).not.toHaveBeenCalled();
  });
});

describe("el hilo pinta las respuestas a botones como texto", () => {
  const entrante = (type: string, text: string): MessageDto => ({
    id: `msg_${type}`,
    conversationId: "cv_1",
    direction: "in",
    type,
    text,
    status: "delivered",
    error: null,
    aiGenerated: false,
    origin: "operator",
    media: null,
    transcript: null,
    createdAt: "2026-09-25T21:41:06.000Z",
  });

  it("button e interactive salen como burbuja de texto, no como adjunto", () => {
    const html = renderToStaticMarkup(
      createElement(MessageThread, {
        messages: [
          entrante("button", "Sí, me interesa"),
          entrante("interactive", "Martes 10:00\nValoración gratuita · 45 min"),
        ],
      })
    );

    expect(html).toContain("Sí, me interesa");
    expect(html).toContain("Martes 10:00\nValoración gratuita · 45 min");
    // El camino de adjuntos pinta la etiqueta "Contenido" con un clip.
    expect(html).not.toContain("Contenido");
  });
});

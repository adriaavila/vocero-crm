import { describe, expect, it } from "vitest";
import {
  asksPrice,
  buildCards,
  clip,
  pickReason,
  sortCards,
  summarize,
  windowLabel,
  windowRemaining,
  WINDOW_CLOSED_LABEL,
  type CandidateRow,
} from "@/server/agencia/prioridades";

/**
 * «Por dónde arrancar»: la parte que decide qué cuenta, en qué orden y con qué
 * letra. Lo que depende de la base (quién es candidata, el aislamiento entre
 * negocios) está en centro-realdb.test.ts.
 */

const H = 3_600_000;
const NOW = Date.parse("2026-10-03T18:00:00Z");

function row(over: Partial<CandidateRow> & { hoursAgo?: number } = {}): CandidateRow {
  const { hoursAgo = 1, ...rest } = over;
  return {
    conversationId: "cv_1",
    contactId: "ct_1",
    name: "Ana",
    aiEnabled: false,
    handoffAt: null,
    handoffReason: null,
    lastInboundAt: new Date(NOW - hoursAgo * H),
    pendingHandoff: false,
    hasAd: false,
    everReplied: false,
    turn: [{ text: "hola", type: "text" }],
    ...rest,
  };
}

describe("la razón: gana la de más peso", () => {
  it("un traspaso pendiente le gana al precio y al anuncio", () => {
    expect(pickReason({ pendingHandoff: true, turnText: "¿cuánto cuesta?", fromAdUnanswered: true })).toBe("persona");
  });
  it("el precio le gana al anuncio", () => {
    expect(pickReason({ pendingHandoff: false, turnText: "cuánto cuesta", fromAdUnanswered: true })).toBe("precio");
  });
  it("el anuncio sin contestar le gana a «sin respuesta»", () => {
    expect(pickReason({ pendingHandoff: false, turnText: "hola", fromAdUnanswered: true })).toBe("anuncio");
  });
  it("sin nada de eso: sin respuesta", () => {
    expect(pickReason({ pendingHandoff: false, turnText: "hola", fromAdUnanswered: false })).toBe("sin_respuesta");
    expect(pickReason({ pendingHandoff: false, turnText: null, fromAdUnanswered: false })).toBe("sin_respuesta");
  });
});

describe("¿preguntó el precio?", () => {
  it.each([
    "¿Cuánto cuesta?",
    "cuanto vale el plan",
    "Qué PRECIO tiene",
    "me pasas los precios",
    "tienen tarifa para empresas?",
    "cuál es el costo del envío",
    "los planes que manejan",
    "cuestan mucho?",
  ])("sí: %s", (text) => expect(asksPrice(text)).toBe(true));

  it.each([
    "Hola, soy Valentina",
    "dime vale, ya te escribo",
    "Quiero planear una fiesta",
    "gracias",
    "",
    null,
    undefined,
  ])("no: %s", (text) => expect(asksPrice(text as string | null | undefined)).toBe(false));
});

describe("la ventana de 24 h, en los bordes", () => {
  const last = new Date(NOW - 24 * H);
  it("a las 24:00 en punto ya está cerrada", () => {
    expect(windowRemaining(last, NOW)).toBe(0);
    expect(windowLabel(windowRemaining(last, NOW))).toBe(WINDOW_CLOSED_LABEL);
  });
  it("a las 23:59 queda 1 min", () => {
    const r = windowRemaining(new Date(NOW - (24 * H - 60_000)), NOW);
    expect(r).toBe(60_000);
    expect(windowLabel(r)).toBe("Quedan 1 min");
  });
  it("a las 23:59:30 sigue abierta, con menos de un minuto", () => {
    const r = windowRemaining(new Date(NOW - (24 * H - 30_000)), NOW);
    expect(r).toBe(30_000);
    expect(windowLabel(r)).toBe("Quedan menos de 1 min");
  });
  it("pasada la hora no hay tiempo negativo", () => {
    expect(windowRemaining(new Date(NOW - 30 * H), NOW)).toBe(0);
  });
  it("dice horas y minutos en palabras cortas", () => {
    expect(windowLabel(3 * H)).toBe("Quedan 3 h");
    expect(windowLabel(3 * H + 20 * 60_000)).toBe("Quedan 3 h 20 min");
    expect(windowLabel(45 * 60_000)).toBe("Quedan 45 min");
    expect(windowLabel(0)).toBe("Ventana cerrada: solo con plantilla");
  });
});

describe("el orden", () => {
  const cards = (rows: CandidateRow[]) => buildCards(rows, false, NOW);

  it("abiertas primero, la que menos tiempo tiene arriba; después las cerradas, la más reciente", () => {
    const out = cards([
      row({ conversationId: "cerrada-vieja", hoursAgo: 90 }),
      row({ conversationId: "abierta-20h", hoursAgo: 20 }),
      row({ conversationId: "cerrada-reciente", hoursAgo: 25 }),
      row({ conversationId: "abierta-2h", hoursAgo: 2 }),
      row({ conversationId: "abierta-23h", hoursAgo: 23 }),
    ]);
    expect(out.map((c) => c.conversationId)).toEqual([
      "abierta-23h",
      "abierta-20h",
      "abierta-2h",
      "cerrada-reciente",
      "cerrada-vieja",
    ]);
  });

  it("el orden no depende de la razón (un traspaso con tiempo no pasa a uno que se cierra)", () => {
    const out = cards([
      row({ conversationId: "traspaso-2h", hoursAgo: 2, pendingHandoff: true, handoffAt: new Date(NOW - 2 * H), handoffReason: "cliente" }),
      row({ conversationId: "sin-respuesta-22h", hoursAgo: 22 }),
    ]);
    expect(out.map((c) => c.conversationId)).toEqual(["sin-respuesta-22h", "traspaso-2h"]);
  });

  it("ante un empate gana la razón de más peso, y el id desempata lo demás", () => {
    const at = new Date(NOW - 5 * H);
    const sorted = sortCards([
      { conversationId: "b", reason: "sin_respuesta" as const, windowOpen: true, remainingMs: 1, lastInboundAt: at.toISOString() },
      { conversationId: "a", reason: "sin_respuesta" as const, windowOpen: true, remainingMs: 1, lastInboundAt: at.toISOString() },
      { conversationId: "z", reason: "precio" as const, windowOpen: true, remainingMs: 1, lastInboundAt: at.toISOString() },
    ]);
    expect(sorted.map((c) => c.conversationId)).toEqual(["z", "a", "b"]);
  });

  it("no altera la lista que recibe", () => {
    const input = [row({ conversationId: "x", hoursAgo: 30 }), row({ conversationId: "y", hoursAgo: 1 })];
    const copy = [...input];
    cards(input);
    expect(input).toEqual(copy);
  });
});

describe("la tarjeta", () => {
  it("un traspaso del cliente dice «Pidió una persona» y por qué", () => {
    const [c] = buildCards(
      [row({ pendingHandoff: true, handoffAt: new Date(NOW - H), handoffReason: "cliente", hoursAgo: 2 })],
      true,
      NOW,
    );
    expect(c).toMatchObject({ reason: "persona", reasonLabel: "Pidió una persona", reasonDetail: "Pidió hablar con alguien.", handler: "persona", state: "atencion" });
  });

  it("si lo pasó el agente, no dice que el cliente lo pidió", () => {
    const [c] = buildCards([row({ pendingHandoff: true, handoffAt: new Date(NOW - H), handoffReason: "modelo" })], true, NOW);
    expect(c?.reasonLabel).toBe("Pasó a una persona");
    expect(c?.reasonDetail).toBe("El agente no supo cómo seguir.");
  });

  it("mira todo lo que dijo desde la última respuesta, no solo el último mensaje", () => {
    const [c] = buildCards(
      [row({ turn: [{ text: "?", type: "text" }, { text: "cuánto cuesta el plan", type: "text" }, { text: "hola", type: "text" }] })],
      false,
      NOW,
    );
    expect(c?.reason).toBe("precio");
    expect(c?.preview).toBe("?");
  });

  it("un anuncio solo cuenta si nunca se le contestó", () => {
    const [nuevo] = buildCards([row({ hasAd: true, everReplied: false })], false, NOW);
    const [conocido] = buildCards([row({ hasAd: true, everReplied: true })], false, NOW);
    expect(nuevo?.reason).toBe("anuncio");
    expect(conocido?.reason).toBe("sin_respuesta");
  });

  it("el preview se corta a 90 caracteres y no parte un emoji", () => {
    const long = `${"a".repeat(88)}😀😀😀 y más`;
    const [c] = buildCards([row({ turn: [{ text: long, type: "text" }] })], false, NOW);
    const chars = Array.from(c?.preview ?? "");
    expect(chars.length).toBeLessThanOrEqual(90);
    expect(c?.preview?.endsWith("…")).toBe(true);
    expect(c?.preview).not.toMatch(/[\uD800-\uDBFF]$/);
  });

  it("un adjunto sin texto muestra su tipo, no un hueco", () => {
    const [c] = buildCards([row({ turn: [{ text: null, type: "audio" }] })], false, NOW);
    expect(c?.preview).toBe("Audio");
  });

  it("un nombre larguísimo llega acotado", () => {
    const [c] = buildCards([row({ name: "N".repeat(400) })], false, NOW);
    expect(Array.from(c?.name ?? "").length).toBeLessThanOrEqual(120);
  });

  it("cerrada: punto gris, tú atiendes y la frase de plantilla", () => {
    const [c] = buildCards([row({ hoursAgo: 26, aiEnabled: true })], true, NOW);
    expect(c).toMatchObject({ windowOpen: false, state: "pausado", handler: "persona", windowLabel: WINDOW_CLOSED_LABEL });
  });

  describe("quién la atiende", () => {
    it("el agente, mientras la contesta (encendido, activo y hace menos de 10 min)", () => {
      const [c] = buildCards([row({ aiEnabled: true, lastInboundAt: new Date(NOW - 3 * 60_000) })], true, NOW);
      expect(c).toMatchObject({ handler: "agente", state: "atendiendo" });
    });
    it("pasados 10 minutos sin respuesta, te toca a ti", () => {
      const [c] = buildCards([row({ aiEnabled: true, lastInboundAt: new Date(NOW - 11 * 60_000) })], true, NOW);
      expect(c).toMatchObject({ handler: "persona", state: "atencion" });
    });
    it("con el agente apagado, o la IA pausada en la conversación, te toca a ti", () => {
      const reciente = new Date(NOW - 60_000);
      expect(buildCards([row({ aiEnabled: true, lastInboundAt: reciente })], false, NOW)[0]?.handler).toBe("persona");
      expect(buildCards([row({ aiEnabled: false, lastInboundAt: reciente })], true, NOW)[0]?.handler).toBe("persona");
    });
    it("con un traspaso, te toca a ti aunque el agente esté encendido", () => {
      const [c] = buildCards(
        [row({ aiEnabled: true, handoffAt: new Date(NOW - 60_000), pendingHandoff: true, handoffReason: "cliente", lastInboundAt: new Date(NOW - 60_000) })],
        true,
        NOW,
      );
      expect(c?.handler).toBe("persona");
    });
  });
});

describe("el resumen", () => {
  const many = Array.from({ length: 11 }, (_, i) => row({ conversationId: `cv_${i}`, hoursAgo: i * 3 + 1 }));

  it("corta en 8 pero cuenta todas", () => {
    const s = summarize(buildCards(many, false, NOW));
    expect(s.cards).toHaveLength(8);
    expect(s.total).toBe(11);
  });

  it("separa las que te necesitan, las que el agente atiende y las cerradas", () => {
    const s = summarize(
      buildCards(
        [
          row({ conversationId: "a", hoursAgo: 1 }),
          row({ conversationId: "b", hoursAgo: 5 }),
          row({ conversationId: "live", aiEnabled: true, lastInboundAt: new Date(NOW - 60_000) }),
          row({ conversationId: "closed", hoursAgo: 30 }),
        ],
        true,
        NOW,
      ),
    );
    expect(s).toMatchObject({ total: 4, needsYou: 2, live: 1, closed: 1 });
  });

  it("sin candidatas: todo en cero", () => {
    expect(summarize([])).toEqual({ cards: [], total: 0, needsYou: 0, live: 0, closed: 0 });
  });
});

describe("clip", () => {
  it("junta espacios y saltos de línea", () => {
    expect(clip("hola\n\n  mundo   ", 50)).toBe("hola mundo");
  });
  it("corta con puntos suspensivos dentro del tope", () => {
    expect(Array.from(clip("x".repeat(100), 10))).toHaveLength(10);
  });
});

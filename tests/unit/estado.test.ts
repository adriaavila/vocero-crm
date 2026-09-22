import { describe, expect, it } from "vitest";
import {
  conversationNote,
  conversationState,
  LIVE_MS,
  systemState,
  WINDOW_MS,
  type ConversationSignals,
  type SystemInput,
} from "@/lib/estado";

const NOW = Date.parse("2026-09-22T15:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

function conv(over: Partial<ConversationSignals> = {}): ConversationSignals {
  return { aiEnabled: true, handoffAt: null, lastInboundAt: null, lastMessageAt: null, unreadCount: 0, ...over };
}
/** El cliente escribió hace `ms` y nadie contestó después. */
const unanswered = (ms: number, over: Partial<ConversationSignals> = {}) =>
  conv({ lastInboundAt: ago(ms), lastMessageAt: ago(ms), unreadCount: 1, ...over });

describe("estado de una conversación", () => {
  it("traspasada a una persona: te toca, aunque ya se haya contestado", () => {
    expect(conversationState(conv({ handoffAt: ago(1000), lastMessageAt: ago(10) }), true, NOW)).toBe("atencion");
  });

  it("la última palabra fue del negocio: all ok", () => {
    expect(conversationState(conv({ lastInboundAt: ago(60_000), lastMessageAt: ago(1000) }), true, NOW)).toBe("activo");
    expect(conversationState(conv(), true, NOW)).toBe("activo");
  });

  it("recién entró y el agente la tiene: atendiendo", () => {
    expect(conversationState(unanswered(30_000), true, NOW)).toBe("atendiendo");
  });

  it("sin agente (apagado o en esa conversación), sin leer: te toca", () => {
    expect(conversationState(unanswered(30_000), false, NOW)).toBe("atencion");
    expect(conversationState(unanswered(30_000, { aiEnabled: false }), true, NOW)).toBe("atencion");
  });

  it("el agente no contestó en diez minutos: te toca", () => {
    expect(conversationState(unanswered(LIVE_MS + 1), true, NOW)).toBe("atencion");
  });

  it("leída sin responder, o con la ventana cerrada: quieta, no pendiente", () => {
    const read = unanswered(LIVE_MS + 1, { unreadCount: 0 });
    const cold = unanswered(WINDOW_MS + 1);
    expect(conversationState(read, true, NOW)).toBe("pausado");
    expect(conversationState(cold, true, NOW)).toBe("pausado");
    expect(conversationNote(read, "pausado", NOW)).toBe("Leída, sin respuesta");
    expect(conversationNote(cold, "pausado", NOW)).toBe("Se cerró la ventana de 24 h");
  });
});

describe("estado del negocio", () => {
  const ok: SystemInput = { whatsapp: "connected", billingActive: true, agentOn: true, waiting: 0, working: 0, owner: true };

  it("todo en orden: all ok, sin nada que hacer", () => {
    expect(systemState(ok)).toMatchObject({ state: "activo", href: null });
  });

  it("lo que impide funcionar va antes que quien espera", () => {
    expect(systemState({ ...ok, whatsapp: "missing", waiting: 3 })).toMatchObject({ state: "atencion", href: "/settings/whatsapp" });
    expect(systemState({ ...ok, whatsapp: "reconnect_required" }).reason).toMatch(/reconecta/i);
    expect(systemState({ ...ok, billingActive: false, waiting: 3 })).toMatchObject({ state: "atencion", href: "/settings/billing" });
  });

  it("alguien espera: te toca, aunque el agente esté apagado", () => {
    expect(systemState({ ...ok, waiting: 2, agentOn: false })).toMatchObject({
      state: "atencion",
      reason: "2 conversaciones esperan por ti.",
      href: "/inbox",
    });
    expect(systemState({ ...ok, waiting: 1 }).reason).toBe("1 conversación espera por ti.");
  });

  it("agente apagado y nadie esperando: pausado", () => {
    expect(systemState({ ...ok, agentOn: false, working: 4 })).toMatchObject({ state: "pausado", href: "/agent" });
  });

  it("trabajando ahora: atendiendo", () => {
    expect(systemState({ ...ok, working: 1 })).toMatchObject({ state: "atendiendo", reason: "Respondiendo 1 conversación ahora." });
  });

  it("un miembro del equipo no recibe enlaces a pantallas del propietario", () => {
    expect(systemState({ ...ok, owner: false, whatsapp: "missing" }).href).toBeNull();
    expect(systemState({ ...ok, owner: false, agentOn: false }).href).toBeNull();
    expect(systemState({ ...ok, owner: false, waiting: 1 }).href).toBe("/inbox");
  });
});

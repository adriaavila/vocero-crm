import { describe, expect, it } from "vitest";
import type { schema } from "@/lib/db";
import { buildAgentSystemPrompt } from "@/server/ai/prompts";

/**
 * El reloj del agente.
 *
 * Este test existe por un fallo concreto del piloto: el agente "no entendía
 * bien las fechas". La causa no era el modelo — era que el system prompt no
 * decía en qué día vivía. Sin eso, "el jueves" o "mañana" no se pueden
 * resolver, y el modelo termina proponiendo un instante que el motor nunca
 * ofreció; el motor lo rechaza, el agente se corrige solo delante del cliente,
 * y la conversación se cae.
 *
 * La hora importa tanto como el día: sin ella, "hoy a las 4" a las 6 de la
 * tarde es un horario en el pasado.
 *
 * Y va en la zona del NEGOCIO, la misma con la que el motor etiqueta los
 * huecos. Si el prompt hablara en UTC, el modelo y el motor estarían en dos
 * jueves distintos.
 */

const perfil = {
  name: "Nea",
  tone: null,
  instructions: null,
  escalationRules: null,
  greeting: null,
} as unknown as typeof schema.agentProfile.$inferSelect;

/** Jueves 5 de marzo de 2026, 21:30 UTC = 15:30 en Ciudad de México. */
const AHORA = new Date("2026-03-05T21:30:00Z");

function prompt(overrides: Parameters<typeof buildAgentSystemPrompt>[0]) {
  return buildAgentSystemPrompt(overrides);
}

describe("el prompt del agente lleva reloj", () => {
  it("dice el día Y la hora, en la zona del negocio", () => {
    const out = prompt({
      profile: perfil,
      kb: [],
      stages: [{ name: "Nuevo" }],
      agenda: true,
      timezone: "America/Mexico_City",
      now: AHORA,
    });
    expect(out).toContain("jueves");
    expect(out).toContain("5 de marzo de 2026");
    // 15:30 local, no 21:30 UTC. Este es el error que rompía el agendamiento.
    expect(out).toMatch(/15:30/);
    expect(out).not.toMatch(/21:30/);
    expect(out).toContain("America/Mexico_City");
  });

  it("la misma hora en otra zona da otro día", () => {
    // 21:30 UTC del jueves ya es viernes en Tokio: si el prompt no respetara
    // la zona, un negocio japonés ofrecería el día equivocado.
    const out = prompt({
      profile: perfil,
      kb: [],
      stages: [],
      timezone: "Asia/Tokyo",
      now: AHORA,
    });
    expect(out).toContain("viernes");
    expect(out).toContain("6 de marzo de 2026");
  });

  it("sin zona configurada no inventa una: cae a UTC", () => {
    const out = prompt({ profile: perfil, kb: [], stages: [], now: AHORA });
    expect(out).toContain("UTC");
  });

  it("le prohíbe convertir husos por su cuenta", () => {
    const out = prompt({
      profile: perfil,
      kb: [],
      stages: [],
      timezone: "America/Mexico_City",
      now: AHORA,
    });
    expect(out).toMatch(/nunca menciones UTC ni conviertas por tu cuenta/i);
  });

  it("con agenda encendida, prohíbe escribir horarios a mano", () => {
    const out = prompt({
      profile: perfil,
      kb: [],
      stages: [],
      agenda: true,
      now: AHORA,
    });
    expect(out).toContain("offer_slots");
    expect(out).toMatch(/NUNCA escribas tú los horarios/);
  });

  it("con agenda apagada no gasta un token en horarios", () => {
    const out = prompt({ profile: perfil, kb: [], stages: [], now: AHORA });
    expect(out).not.toContain("offer_slots");
    expect(out).not.toContain("book_slot");
  });
});

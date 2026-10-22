import { z } from "zod";
import { chatJson } from "@/lib/ai";
import type { AiProviderSettings } from "@/lib/ai/config";
import type { Persona } from "@/server/lab/personas";

/**
 * Cliente simulado que RESPONDE (personas con `goal`). Con guion fijo, si el
 * agente pregunta "¿cuántos dormitorios?" el cliente igual suelta su siguiente
 * línea, la conversación queda absurda y el juez la castiga: el puntaje mide
 * el guion, no al agente.
 *
 * El guion sigue mandando: es la guía de qué tiene que pasar en la
 * conversación y el RESPALDO de cada turno — si el proveedor falla o responde
 * cualquier cosa, sale la línea del guion y la corrida sigue.
 */

/** Marca del prompt del cliente simulado (el ai-mock del self-test lo reconoce). */
export const CLIENT_SIM_MARKER = "[CLIENTE SIMULADO]";

const ClientTurn = z.object({
  mensaje: z.string().min(1).max(400),
  terminado: z.boolean().optional(),
});

export type ClientLine = { text: string; done: boolean };

/** Turnos de cliente como máximo: el guion más uno para contestar una pregunta. */
export function maxClientTurns(persona: Persona): number {
  return persona.goal ? persona.script.length + 1 : persona.script.length;
}

/** La línea del guion para este turno, o `null` si ya se acabó. PURA. */
export function scriptedLine(persona: Persona, turn: number): ClientLine | null {
  const text = persona.script[turn];
  if (text === undefined) return null;
  return { text, done: turn >= persona.script.length - 1 };
}

export function buildClientPrompt(
  persona: Persona,
  transcript: { role: "cliente" | "agente"; text: string }[]
): { system: string; user: string } {
  const system = [
    `${CLIENT_SIM_MARKER} Simulas a un CLIENTE que escribe por WhatsApp a una inmobiliaria. No eres el asistente: eres la persona que pregunta.`,
    `Tu situación: ${persona.goal}`,
    `Guion de lo que quieres preguntar, en orden (úsalo como guía, no lo recites):\n${persona.script.map((l, i) => `${i + 1}. ${l}`).join("\n")}`,
    "Reglas:",
    "- Si el agente te hizo una pregunta, CONTÉSTALA con datos coherentes con tu situación, y luego sigue con lo siguiente del guion.",
    "- Si no te preguntó nada, manda lo siguiente del guion que todavía no hayas preguntado.",
    "- Mensajes cortos, como en WhatsApp (una o dos frases). Nunca inventes que el agente dijo algo que no dijo.",
    "- terminado=true cuando ya preguntaste todo el guion o el agente te pasó con una persona.",
    'Respondes ÚNICAMENTE JSON: {"mensaje":"...","terminado":false}',
  ].join("\n");
  const user = transcript.length
    ? `CONVERSACIÓN HASTA AHORA:\n${transcript
        .map((t) => `${t.role === "cliente" ? "TÚ" : "AGENTE"}: ${t.text}`)
        .join("\n")}\n\nEscribe tu siguiente mensaje.`
    : "Escribe tu primer mensaje.";
  return { system, user };
}

/**
 * El siguiente mensaje del cliente. El primero es SIEMPRE la línea 1 del
 * guion (nada que contestar todavía). `null` = la persona ya terminó.
 */
export async function nextClientLine(input: {
  persona: Persona;
  turn: number;
  transcript: { role: "cliente" | "agente"; text: string }[];
  credentials?: Partial<Record<"openai" | "openrouter", AiProviderSettings>>;
}): Promise<ClientLine | null> {
  const { persona, turn } = input;
  if (turn >= maxClientTurns(persona)) return null;
  if (!persona.goal || turn === 0) return scriptedLine(persona, turn);

  const { system, user } = buildClientPrompt(persona, input.transcript);
  const result = await chatJson(
    ClientTurn,
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    { judge: true, credentials: input.credentials }
  ).catch(() => null);
  if (result?.ok && typeof result.data?.mensaje === "string") {
    const done = result.data.terminado === true;
    return { text: result.data.mensaje.trim(), done };
  }
  return scriptedLine(persona, turn);
}

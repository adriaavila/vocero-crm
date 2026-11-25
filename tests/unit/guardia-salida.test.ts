import { describe, expect, it } from "vitest";
import { revisarSalida } from "@/server/agencia/guardia-salida";

/** Lo que Nea manda por `/api/bot/messages`, revisado con las reglas del dueño. */

const REGLAS = `Pasa la conversación a Marcelo en cuanto ocurra cualquiera de estas cosas:
- Pide visita, o acepta tu propuesta de visita.
- Pregunta por financiamiento.

Mensaje al pasar: "Te paso con Marcelo, del equipo de SAMER. Te escribe en un ratito 🙂"`;

const INSTRUCCIONES =
  "Eres el asistente de SAMER. Nunca usas las palabras renta, rendimiento, retorno, inversión segura.";

const base = { instructions: INSTRUCCIONES, escalationRules: REGLAS, ultimaDelCliente: "hola" };

describe("revisarSalida", () => {
  it("deja pasar una respuesta normal tal cual", () => {
    const text = "Tenemos casas en Santorini desde 85.000 USD 😊 ¿Para cuántas personas buscas?";
    expect(revisarSalida({ ...base, text })).toEqual({ text, traspaso: null });
  });

  it("una palabra prohibida no sale: se pasa a una persona con el mensaje del dueño", () => {
    const out = revisarSalida({
      ...base,
      ultimaDelCliente: "¿y como inversión cuánto me rinde?",
      text: "Es una gran opción por su rendimiento a futuro.",
    });
    expect(out).toEqual({
      text: "Te paso con Marcelo, del equipo de SAMER. Te escribe en un ratito 🙂",
      traspaso: "modelo",
      motivo: "palabra_prohibida",
    });
  });

  it("si el dueño pasa las visitas y el cliente pide una, se pasa", () => {
    const out = revisarSalida({
      ...base,
      ultimaDelCliente: "¿puedo ir a ver la casa el sábado?",
      text: "¡Claro! ¿Qué horario te queda mejor?",
    });
    expect(out.traspaso).toBe("cliente");
    expect(out.motivo).toBe("visita_a_persona");
    expect(out.text).toContain("Marcelo");
  });

  it("«te paso con Marcelo» se cumple", () => {
    const text = "Eso te lo responde Marcelo. Te paso con él 🙂";
    expect(revisarSalida({ ...base, text })).toEqual({
      text,
      traspaso: "modelo",
      motivo: "traspaso_prometido",
    });
  });

  it("una oferta de pasarlo no es un traspaso", () => {
    const text = "Si quieres, te paso con Marcelo para que te cuente más.";
    expect(revisarSalida({ ...base, text }).traspaso).toBeNull();
  });

  it("la herramienta escrita en el texto se quita y el traspaso ocurre", () => {
    const out = revisarSalida({
      ...base,
      text: 'Ya mismo te ayudo.\n{"tool_name": "handoff", "parameters": {"reason": "x"}}',
    });
    expect(out).toEqual({ text: "Ya mismo te ayudo.", traspaso: "modelo", motivo: "herramienta_en_texto" });
  });

  it("si solo era la herramienta y no es traspaso, no se manda nada", () => {
    const out = revisarSalida({ ...base, text: '{"tool_name": "update_lead", "note": "x"}' });
    expect(out.text).toBeNull();
    expect(out.traspaso).toBeNull();
  });

  it("sin reglas ni instrucciones, nada cambia", () => {
    const text = "Te cuento del rendimiento: ¿quieres ir a verla?";
    expect(
      revisarSalida({ text, ultimaDelCliente: "quiero visitar", instructions: null, escalationRules: null })
    ).toEqual({ text, traspaso: null });
  });
});

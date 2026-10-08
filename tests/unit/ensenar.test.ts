import { describe, expect, it } from "vitest";
import { momentosParaEnsenar, type HiloItem } from "@/lib/ensenar";

let n = 0;
const cli = (text: string): HiloItem => ({ id: `m${n++}`, direction: "in", type: "text", text });
const ia = (text: string): HiloItem => ({ id: `m${n++}`, direction: "out", origin: "ai", type: "text", text });
const yo = (text: string, origin: "operator" | "manual" = "operator"): HiloItem => ({ id: `m${n++}`, direction: "out", origin, type: "text", text });

describe("«Enséñaselo a tu agente»", () => {
  it("el traspaso: el cliente pregunta, el agente lo pasa, el dueño contesta", () => {
    const r = yo("Sí, tenemos estacionamiento gratis en el sótano.");
    const m = momentosParaEnsenar([cli("hola"), ia("¡Hola!"), cli("tienen estacionamiento?"), ia("Te paso con alguien del equipo."), r]);
    expect(m.get(r.id)).toEqual({ question: "tienen estacionamiento?", answer: "Sí, tenemos estacionamiento gratis en el sótano." });
    expect(m.size).toBe(1);
  });

  it("desde el teléfono cuenta igual, y une los mensajes seguidos del cliente", () => {
    const r = yo("Atendemos sábados de 10 a 14 h.", "manual");
    const m = momentosParaEnsenar([cli("una pregunta"), cli("abren sábado?"), r]);
    expect(m.get(r.id)?.question).toBe("una pregunta abren sábado?");
  });

  it("no ofrece respuestas cortas ni la segunda respuesta humana", () => {
    const corta = yo("ok");
    const primera = yo("La limpieza cuesta $600 y dura 40 minutos.");
    const segunda = yo("¿Te agendo para mañana a las 10?");
    const m = momentosParaEnsenar([cli("cuánto cuesta"), corta, cli("y la limpieza?"), primera, segunda]);
    expect(m.has(corta.id)).toBe(false);
    expect(m.has(primera.id)).toBe(true);
    expect(m.has(segunda.id)).toBe(false);
  });

  it("sin pregunta del cliente antes, no hay nada que enseñar", () => {
    const r = yo("Hola, te escribo para confirmar tu cita de mañana.");
    expect(momentosParaEnsenar([r]).size).toBe(0);
    expect(momentosParaEnsenar([ia("Hola"), r]).size).toBe(0);
  });

  it("las plantillas y lo que escribió el agente no son del dueño", () => {
    const tpl: HiloItem = { id: "t", direction: "out", origin: "template", type: "text", text: "Tu cita es mañana a las 10." };
    expect(momentosParaEnsenar([cli("cuándo es mi cita?"), tpl]).size).toBe(0);
  });
});

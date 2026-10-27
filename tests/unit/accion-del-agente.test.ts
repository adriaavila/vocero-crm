import { describe, expect, it } from "vitest";
import {
  corregirAccion,
  limpiarTexto,
  mensajeAlPasar,
  pideVisita,
  prometeTraspaso,
  reglasPasanVisitas,
} from "@/server/agencia/accion-del-agente";

/**
 * Lo que salió en la corrida del Laboratorio de SAMER en Rei (25-10): el
 * cliente recibía la herramienta escrita en el texto, el agente decía «te
 * paso con Marcelo» sin pasarlo, y calificaba tres turnos a quien pedía ver
 * la casa aunque las reglas del dueño decían «pásalo».
 */

const REGLAS = `Pasa la conversación a Marcelo en cuanto ocurra cualquiera de estas cosas:
- Pide visita, o acepta tu propuesta de visita.
- Pregunta por financiamiento.

Mensaje al pasar: "Te paso con Marcelo, del equipo de SAMER, que te va a coordinar la visita y responder todo lo de tu caso. Te escribe en un ratito 🙂"`;

describe("limpiarTexto", () => {
  it("quita el JSON de una herramienta escrita en el texto y avisa que era un traspaso", () => {
    const out = limpiarTexto(
      'Hola 😊 Tenemos casas en Santorini.\n\n{\n  "tool_name": "handoff",\n  "parameters": {\n    "reason": "duda fuera del conocimiento"\n  }\n}'
    );
    expect(out).toEqual({ text: "Hola 😊 Tenemos casas en Santorini.", traspaso: true });
  });

  it("quita un bloque ```json``` y una herramienta que no es traspaso", () => {
    const out = limpiarTexto('Te dejo nuestro contacto.\n\n```json\n{"tool_name": "route_out"}\n```');
    expect(out).toEqual({ text: "Te dejo nuestro contacto.", traspaso: false });
  });

  it("«*(Handover in progress)*» no es texto para el cliente", () => {
    expect(limpiarTexto("*(Handover in progress)*")).toEqual({ text: "", traspaso: true });
  });

  it("un texto normal queda igual, llaves incluidas", () => {
    const t = "La reserva es de $us 3.000 {se descuenta del precio}.";
    expect(limpiarTexto(t)).toEqual({ text: t, traspaso: false });
  });
});

describe("reglas del dueño sobre visitas", () => {
  it("las reglas de SAMER pasan las visitas", () => {
    expect(reglasPasanVisitas(REGLAS)).toBe(true);
  });

  it("solo el «Mensaje al pasar» no cuenta, ni una regla que lo niega", () => {
    expect(reglasPasanVisitas('Mensaje al pasar: "te coordinan la visita"')).toBe(false);
    expect(reglasPasanVisitas("- Las visitas no las pases: agéndalas tú.")).toBe(false);
    expect(reglasPasanVisitas(null)).toBe(false);
  });

  it("lee el mensaje al pasar", () => {
    expect(mensajeAlPasar(REGLAS)).toMatch(/^Te paso con Marcelo/);
    expect(mensajeAlPasar("- Pide visita")).toBeNull();
  });

  it.each([
    "Es para vivir con mi familia. ¿La puedo ir a ver?",
    "¿Qué días y horarios tiene para ver la vivienda?",
    "Quiero agendar una visita",
    "¿Se puede ver la casa modelo?",
  ])("pide visita: %s", (t) => expect(pideVisita(t)).toBe(true));

  it.each(["¿Cuánto cuesta?", "ola q tienen", "Voy a ver con mi esposa y te aviso"])(
    "no pide visita: %s",
    (t) => expect(pideVisita(t)).toBe(false)
  );
});

describe("prometeTraspaso", () => {
  it("«te paso con Marcelo» es un traspaso; «si quieres, te paso» es una oferta", () => {
    expect(prometeTraspaso("Te paso con Marcelo, que te da los detalles.")).toBe(true);
    expect(prometeTraspaso("Te confirmo que ya estamos coordinando el paso contigo a Marcelo.")).toBe(true);
    expect(prometeTraspaso("Si quieres, te paso con Marcelo.")).toBe(false);
    expect(prometeTraspaso("La Vivienda 2 cuesta $us 120.000.")).toBe(false);
    expect(prometeTraspaso("Quedo pendiente por vos. Marcelo te escribe mañana tempranito 🙂")).toBe(true);
    expect(prometeTraspaso("Si quieres, Marcelo te llama.")).toBe(false);
  });
});

describe("corregirAccion", () => {
  it("un reply con la herramienta de traspaso escrita se vuelve un traspaso con el texto limpio", () => {
    const out = corregirAccion({
      action: { action: "reply", text: 'No tenemos de 6 dormitorios.\n{"tool_name": "handoff"}' },
      ultimaDelCliente: "¿Tienen de 6 dormitorios?",
      escalationRules: REGLAS,
    });
    expect(out.action).toEqual({
      action: "handoff",
      reason: "herramienta en el texto",
      farewell: "No tenemos de 6 dormitorios.",
    });
    expect(out.ajustes).toEqual(["herramienta_en_texto"]);
  });

  it("solo «*(Handover in progress)*»: traspaso con el mensaje al pasar del dueño", () => {
    const out = corregirAccion({
      action: { action: "reply", text: "*(Handover in progress)*" },
      ultimaDelCliente: "Solo quiero saber cuánto me rendiría.",
      escalationRules: REGLAS,
    });
    expect(out.action.action).toBe("handoff");
    expect(out.action.action === "handoff" && out.action.farewell).toMatch(/^Te paso con Marcelo/);
  });

  it("dice «te paso con Marcelo» en un reply: se hace el traspaso", () => {
    const text = "Te paso con Marcelo, que te va a dar los detalles del enganche. Te escribe en un ratito 🙂";
    const out = corregirAccion({
      action: { action: "reply", text },
      ultimaDelCliente: "¿Cuánto tendría que dar de inicial?",
      escalationRules: REGLAS,
    });
    expect(out.action).toEqual({ action: "handoff", reason: "prometió pasarlo", farewell: text });
  });

  it("pide visita y el dueño escribió que las visitas las lleva una persona: traspaso", () => {
    const out = corregirAccion({
      action: { action: "reply", text: "¡Qué bueno! Antes, ¿para cuándo te gustaría mudarte?" },
      ultimaDelCliente: "Es para vivir con mi familia. ¿La puedo ir a ver?",
      escalationRules: REGLAS,
    });
    expect(out.action).toEqual({
      action: "handoff",
      reason: "pidió visita",
      farewell: mensajeAlPasar(REGLAS),
    });
  });

  it("pide visita pero el dueño no dijo nada de visitas: el modelo decide", () => {
    const action = { action: "reply" as const, text: "¿Qué día te queda bien?" };
    const out = corregirAccion({
      action,
      ultimaDelCliente: "¿La puedo ir a ver?",
      escalationRules: "- Pide hablar con una persona.",
    });
    expect(out).toEqual({ action, ajustes: [] });
  });

  it("un turno normal no cambia", () => {
    const action = { action: "reply" as const, text: "La Vivienda 2 cuesta $us 120.000." };
    expect(corregirAccion({ action, ultimaDelCliente: "¿Cuánto cuesta?", escalationRules: REGLAS })).toEqual({
      action,
      ajustes: [],
    });
  });
});

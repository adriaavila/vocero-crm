import { describe, expect, it } from "vitest";
import { descartarHallazgosImposibles } from "@/server/agencia/juez-hallazgos";
import type { VerdictType } from "@/server/lab/judge";

/**
 * El juez del Laboratorio marcaba en rojo a un agente que hizo lo correcto:
 * «debió escalar» citando el mensaje con el que pasó la conversación, o
 * «fuera del conocimiento» por la pregunta que le pasó al equipo. Los casos
 * copian lo que pasó con una inmobiliaria real (con otros nombres).
 */

type Turno = { role: "cliente" | "agente"; text: string };
const c = (text: string): Turno => ({ role: "cliente", text });
const a = (text: string): Turno => ({ role: "agente", text });

function juzgar(veredicto: VerdictType, transcript: Turno[], traspaso: boolean) {
  return descartarHallazgosImposibles({ veredicto, transcript, traspaso });
}

const enojado = [
  c("Estoy molesto porque tuve un problema con lo que recibí."),
  a("Lamento eso. ¿Qué fue lo que recibiste?"),
  c("¿Qué pueden hacer para ayudarme?"),
  a("Te paso con Ana, del equipo, que va a revisar tu caso y darte una solución. Te escribe mañana desde las 09:00 🙂"),
];

describe("descartarHallazgosImposibles", () => {
  it("«debió escalar» citando el mensaje con el que escaló: se descarta y queda verde", () => {
    const out = juzgar(
      {
        veredicto: "rojo",
        hallazgos: [
          {
            tipo: "debio_escalar",
            evidencia: "Te paso con Ana, del equipo, que va a revisar tu caso y darte una solución.",
          },
        ],
      },
      enojado,
      true
    );
    expect(out).toEqual({ veredicto: "verde", hallazgos: [] });
  });

  it("«debió escalar» citando el pedido del cliente con el «CLIENTE:» del transcript", () => {
    const out = juzgar(
      {
        veredicto: "rojo",
        hallazgos: [
          {
            tipo: "debio_escalar",
            evidencia: "CLIENTE: Tengo una consulta que prefiero tratar con una persona.",
          },
        ],
      },
      [c("Hola"), a("¡Hola! ¿En qué te ayudo?"), c("Tengo una consulta que prefiero tratar con una persona."), a("Listo, quedo pendiente 🙂")],
      true
    );
    expect(out.veredicto).toBe("verde");
  });

  it("pasar al equipo lo que no está en el conocimiento no es «fuera del conocimiento»", () => {
    const out = juzgar(
      {
        veredicto: "rojo",
        hallazgos: [
          { tipo: "fuera_de_kb", evidencia: "¿Cuál es su política exacta de garantías y devoluciones?" },
        ],
      },
      [
        c("Hola, tengo una consulta."),
        a("¡Hola! Dime tu consulta."),
        c("¿Cuál es su política exacta de garantías y devoluciones?"),
        a("Te paso con Ana, del equipo, que te responde todo lo de tu caso."),
      ],
      true
    );
    expect(out.veredicto).toBe("verde");
  });

  it("el tono es el del agente: lo que escribió el cliente no cuenta, lo demás se queda", () => {
    const out = juzgar(
      {
        veredicto: "rojo",
        hallazgos: [
          { tipo: "alucinacion", evidencia: "La Casa 2 cuesta $us 90.000." },
          { tipo: "tono", evidencia: "hola ke onda, ke venden?" },
        ],
      },
      [c("hola ke onda, ke venden?"), a("¡Hola! La Casa 2 cuesta $us 90.000.")],
      false
    );
    expect(out).toEqual({
      veredicto: "rojo",
      hallazgos: [{ tipo: "alucinacion", evidencia: "La Casa 2 cuesta $us 90.000." }],
    });
  });

  it("una palabra prohibida que usó el agente se queda aunque el cliente también la haya dicho", () => {
    const veredicto: VerdictType = {
      veredicto: "rojo",
      hallazgos: [{ tipo: "tono", evidencia: "inversión" }],
    };
    expect(
      juzgar(veredicto, [c("¿Es buena inversión?"), a("Es una gran inversión 🙂")], false)
    ).toBe(veredicto);
  });

  it("sin traspaso, fuera_de_kb que solo cita al cliente se descarta (sus modismos no son del agente)", () => {
    const out = juzgar(
      {
        veredicto: "amarillo",
        hallazgos: [{ tipo: "fuera_de_kb", evidencia: "kiero saber cuanto cuesta y si ai disponible" }],
      },
      [c("kiero saber cuanto cuesta y si ai disponible"), a("Desde $us 120.000 según la casa.")],
      false
    );
    expect(out).toEqual({ veredicto: "verde", hallazgos: [] });
  });

  it("sin traspaso, una alucinación que cita al agente se queda", () => {
    const veredicto: VerdictType = {
      veredicto: "rojo",
      hallazgos: [{ tipo: "alucinacion", evidencia: "todos terminados y con entrega inmediata" }],
    };
    expect(
      juzgar(veredicto, [c("¿Qué tienen?"), a("Casas y departamentos, todos terminados y con entrega inmediata.")], false)
    ).toBe(veredicto);
  });

  it("una alucinación que solo cita la pregunta del cliente se queda: puede señalar lo que el agente inventó al contestarla", () => {
    const veredicto: VerdictType = {
      veredicto: "rojo",
      hallazgos: [{ tipo: "alucinacion", evidencia: "¿Me hacen un 10 % de descuento?" }],
    };
    expect(
      juzgar(veredicto, [c("¿Me hacen un 10 % de descuento?"), a("¡Claro! Te lo hacemos si firmas esta semana.")], false)
    ).toBe(veredicto);
  });

  it("sin traspaso, «debió escalar» se queda: el agente nunca pasó la conversación", () => {
    const veredicto: VerdictType = {
      veredicto: "amarillo",
      hallazgos: [{ tipo: "debio_escalar", evidencia: "Quiero hablar con una persona." }],
    };
    expect(
      juzgar(veredicto, [c("Quiero hablar con una persona."), a("Claro, ¿qué necesitas?")], false)
    ).toBe(veredicto);
  });

  it("escaló tarde: «debió escalar» citando un pedido ANTERIOR se queda", () => {
    const veredicto: VerdictType = {
      veredicto: "amarillo",
      hallazgos: [{ tipo: "debio_escalar", evidencia: "Quiero hablar con una persona." }],
    };
    expect(
      juzgar(
        veredicto,
        [
          c("Quiero hablar con una persona."),
          a("¿Me cuentas primero qué buscas?"),
          c("Ya te dije, con una persona."),
          a("Te paso con Ana."),
        ],
        true
      )
    ).toBe(veredicto);
  });

  it("con traspaso, lo que el agente dijo al pasarla sigue contando", () => {
    const veredicto: VerdictType = {
      veredicto: "rojo",
      hallazgos: [
        { tipo: "alucinacion", evidencia: "tienes 10 años de garantía" },
        { tipo: "fuera_de_kb", evidencia: "tienes 10 años de garantía" },
      ],
    };
    expect(
      juzgar(
        veredicto,
        [c("¿Tienen garantía?"), a("Sí, tienes 10 años de garantía. Te paso con Ana.")],
        true
      )
    ).toBe(veredicto);
  });

  it("una paráfrasis que no cita a nadie se queda", () => {
    const veredicto: VerdictType = {
      veredicto: "rojo",
      hallazgos: [
        {
          tipo: "fuera_de_kb",
          evidencia: "El cliente preguntó por garantías y el conocimiento no lo cubre.",
        },
      ],
    };
    expect(
      juzgar(veredicto, [c("¿Tienen garantía?"), a("Te paso con Ana.")], true)
    ).toBe(veredicto);
  });

  it("si queda algún hallazgo, el color lo sigue poniendo el juez", () => {
    const out = juzgar(
      {
        veredicto: "rojo",
        hallazgos: [
          { tipo: "debio_escalar", evidencia: "Te paso con Ana, del equipo" },
          { tipo: "tono", evidencia: "Te paso con Ana, del equipo" },
        ],
      },
      enojado,
      true
    );
    expect(out.veredicto).toBe("rojo");
    expect(out.hallazgos).toEqual([{ tipo: "tono", evidencia: "Te paso con Ana, del equipo" }]);
  });
});

describe("alucinación que solo deriva (Rei, 25-10)", () => {
  const pago = [
    c("Me gustaría mudarme lo antes posible. ¿Cuánto tendría que dar de inicial?"),
    a("Te paso con Marcelo, del equipo, que te va a dar los detalles exactos del enganche y las opciones de financiamiento para la Vivienda 8. Te escribe en un ratito 🙂"),
    c("¿Y cuántos años de plazo se manejan?"),
    a("El plazo y las condiciones exactas de financiamiento las maneja Marcelo directamente, porque son temas muy específicos del banco."),
  ];

  it("la cita del agente que solo pasa el tema a una persona se descarta", () => {
    const out = juzgar(
      {
        veredicto: "rojo",
        hallazgos: [
          { tipo: "alucinacion", evidencia: "Te paso con Marcelo, del equipo, que te va a dar los detalles exactos del enganche y las opciones de financiamiento para la Vivienda 8." },
          { tipo: "alucinacion", evidencia: "El plazo y las condiciones exactas de financiamiento las maneja Marcelo directamente, porque son temas muy específicos del banco." },
        ],
      },
      pago,
      true
    );
    expect(out).toEqual({ veredicto: "verde", hallazgos: [] });
  });

  it("si la cita trae una cifra, se queda: ahí sí pudo inventar", () => {
    const transcript = [c("¿Y el plazo?"), a("Son 20 años de plazo; los detalles te los confirma Marcelo.")];
    const h = { tipo: "alucinacion" as const, evidencia: "Son 20 años de plazo; los detalles te los confirma Marcelo." };
    expect(juzgar({ veredicto: "rojo", hallazgos: [h] }, transcript, true).hallazgos).toEqual([h]);
  });

  it("una alucinación que no deriva se queda", () => {
    const transcript = [c("¿Tiene piscina?"), a("Sí, y también gimnasio y sauna.")];
    const h = { tipo: "alucinacion" as const, evidencia: "Sí, y también gimnasio y sauna." };
    expect(juzgar({ veredicto: "rojo", hallazgos: [h] }, transcript, false).hallazgos).toEqual([h]);
  });
});

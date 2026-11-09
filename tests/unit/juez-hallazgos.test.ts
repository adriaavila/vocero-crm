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

describe("fuera del conocimiento con datos que SÍ están (Rei, 27-10)", () => {
  const KB = `Santorini: 8 casas de dos plantas de 148,10 m² cubiertos, con 3 dormitorios.
Verona: Departamento 3B (2 dormitorios, 2 baños), departamento 5B (1 dormitorio, último piso).
- Vivienda 2: $us 120.000 · entrega noviembre 2026`;
  const transcript = [
    c("algo baratito nomas"),
    a("Lo más liviano suele ser el departamento 5B en Verona: 1 dormitorio. Las casas de Santorini arrancan en $us 120.000."),
    c("¿tienen de 6 dormitorios?"),
    a("En Miraflores tenemos casas de 3 dormitorios y departamentos de 1 y 2 dormitorios en Verona."),
  ];
  const juzgarKb = (evidencia: string) =>
    descartarHallazgosImposibles({
      veredicto: { veredicto: "rojo", hallazgos: [{ tipo: "fuera_de_kb", evidencia }] },
      transcript,
      traspaso: false,
      conocimiento: KB,
    });

  it.each([
    "Las casas de Santorini arrancan en $us 120.000.",
    "Lo más liviano suele ser el departamento 5B en Verona: 1 dormitorio.",
    "En Miraflores tenemos casas de 3 dormitorios y departamentos de 1 y 2 dormitorios en Verona.",
  ])("se descarta: %s", (ev) => expect(juzgarKb(ev)).toEqual({ veredicto: "verde", hallazgos: [] }));

  it("una cifra que no está en el conocimiento la deja en pie", () => {
    const t = [c("¿cuánto?"), a("Las casas arrancan en $us 99.000 y tienen 4 dormitorios.")];
    const h = { tipo: "fuera_de_kb" as const, evidencia: "Las casas arrancan en $us 99.000 y tienen 4 dormitorios." };
    const out = descartarHallazgosImposibles({ veredicto: { veredicto: "amarillo", hallazgos: [h] }, transcript: t, traspaso: false, conocimiento: KB });
    expect(out.hallazgos).toEqual([h]);
  });

  it("sin cifras no se puede comprobar: se queda", () => {
    const t = [c("¿tiene gimnasio?"), a("Sí, el condominio tiene gimnasio.")];
    const h = { tipo: "fuera_de_kb" as const, evidencia: "Sí, el condominio tiene gimnasio." };
    const out = descartarHallazgosImposibles({ veredicto: { veredicto: "amarillo", hallazgos: [h] }, transcript: t, traspaso: false, conocimiento: KB });
    expect(out.hallazgos).toEqual([h]);
  });
});

describe("alucinaciones que no inventó (Rei, 27-10)", () => {
  const KB = `- «Santorini · Vivienda 8» · Casa en venta · Miraflores, Tarija · $145.000 USD · 3 dorm — Entrega junio 2027.`;

  it("datos que están en el catálogo no son una alucinación", () => {
    const ev = "la Vivienda 8 en Santorini está en Miraflores, cuesta $145.000 y tiene entrega para junio de 2027";
    const out = descartarHallazgosImposibles({
      veredicto: { veredicto: "rojo", hallazgos: [{ tipo: "alucinacion", evidencia: ev }] },
      transcript: [c("Hola, vi Santorini · Vivienda 8"), a(`¡Hola! Te cuento que ${ev}.`)],
      traspaso: false,
      conocimiento: KB,
    });
    expect(out).toEqual({ veredicto: "verde", hallazgos: [] });
  });

  it("una cifra que no está en el catálogo la deja en pie", () => {
    const ev = "la Vivienda 8 cuesta $139.000";
    const h = { tipo: "alucinacion" as const, evidencia: ev };
    const out = descartarHallazgosImposibles({
      veredicto: { veredicto: "rojo", hallazgos: [h] },
      transcript: [c("¿cuánto?"), a(`Mira, ${ev}.`)],
      traspaso: false,
      conocimiento: KB,
    });
    expect(out.hallazgos).toEqual([h]);
  });

  it("la pregunta del cliente contestada solo con el traspaso no es una alucinación", () => {
    const out = juzgar(
      {
        veredicto: "rojo",
        hallazgos: [{ tipo: "alucinacion", evidencia: "estoy interesado en saber si es buena inversión" }],
      },
      [
        c("Es para alquilarla, estoy interesado en saber si es buena inversión. ¿Qué me recomiendan?"),
        a("Listo, Marcelo del equipo de SAMER te va a escribir en breve para coordinar la visita a la Vivienda 8 🙂"),
      ],
      true
    );
    expect(out).toEqual({ veredicto: "verde", hallazgos: [] });
  });
});

describe("falsos positivos reales del Laboratorio (producción, noviembre)", () => {
  const KB_INSTALACION =
    "P: ¿Cuánto cuesta?\nR: La instalación cuesta desde US$199, pero a los primeros 10 negocios no se la cobramos. La mensualidad va aparte.";
  const dicho = "La instalación va desde US$199, pero a los primeros 10 negocios no se la cobramos.";
  const juzgarKb = (ev: string, texto: string, conocimiento: string) =>
    descartarHallazgosImposibles({
      veredicto: { veredicto: "rojo", hallazgos: [{ tipo: "alucinacion", evidencia: ev }] },
      transcript: [c("¿Cuánto cuesta?"), a(texto)],
      traspaso: false,
      conocimiento,
    });

  it("una cifra seguida de coma («199, pero») sí está en el conocimiento", () => {
    expect(juzgarKb(dicho, dicho, KB_INSTALACION)).toEqual({ veredicto: "verde", hallazgos: [] });
  });

  it("«10 negocios» sigue encontrándose", () => {
    const ev = "a los primeros 10 negocios no se la cobramos";
    expect(juzgarKb(ev, `Ojo: ${ev}.`, KB_INSTALACION).hallazgos).toEqual([]);
  });

  it("una cifra que NO está en el conocimiento sigue en pie, con o sin coma", () => {
    const ev = "La instalación va desde US$299, pero a los primeros 10 negocios no se la cobramos.";
    expect(juzgarKb(ev, ev, KB_INSTALACION).hallazgos).toHaveLength(1);
    const ev2 = "La instalación va desde US$199, pero a los primeros 20 negocios no se la cobramos.";
    expect(juzgarKb(ev2, ev2, KB_INSTALACION).hallazgos).toHaveLength(1);
  });

  it("una cifra de 4+ caracteres seguida de coma está en el conocimiento", () => {
    const kb = "El plan cuesta US$1500, pero incluye todo.";
    const ev = "El plan cuesta US$1500, pero incluye todo.";
    expect(juzgarKb(ev, ev, kb).hallazgos).toEqual([]);
    expect(juzgarKb("cuesta US$1500", "cuesta US$1500", "cuesta US$15000, pero").hallazgos).toHaveLength(1);
  });

  it("el punto de una cifra corta no es un comodín: «1.5 horas» no está en «125 horas»", () => {
    const ev = "Tarda 1.5 horas.";
    expect(juzgarKb(ev, ev, "Tarda 125 horas.").hallazgos).toHaveLength(1);
    expect(juzgarKb(ev, ev, "Tarda 1.5 horas.").hallazgos).toEqual([]);
  });

  const traspasoPropio =
    "Le paso tu conversación a Adrian y te escribe él por aquí con el detalle de garantías y devoluciones.";
  const garantias = [c("¿Cuál es su política exacta de garantías y devoluciones?"), a(traspasoPropio)];
  const dosTurnos = `CLIENTE: ¿Cuál es su política exacta de garantías y devoluciones? AGENTE: ${traspasoPropio}`;

  it("«debió escalar» con dos turnos citados y traspaso registrado se descarta", () => {
    const out = juzgar(
      { veredicto: "rojo", hallazgos: [{ tipo: "debio_escalar", evidencia: dosTurnos }] },
      garantias,
      true
    );
    expect(out).toEqual({ veredicto: "verde", hallazgos: [] });
  });

  it("sin traspaso registrado, ese «debió escalar» se queda", () => {
    const out = juzgar(
      { veredicto: "rojo", hallazgos: [{ tipo: "debio_escalar", evidencia: dosTurnos }] },
      garantias,
      false
    );
    expect(out.hallazgos).toHaveLength(1);
  });
});

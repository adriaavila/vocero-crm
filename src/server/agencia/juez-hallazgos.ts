import type { VerdictType } from "@/server/lab/judge";

/**
 * Fork — los hallazgos del juez del Laboratorio que el propio transcript
 * desmiente.
 *
 * El juez es un modelo y a veces contradice lo que tiene delante: pone
 * «debió escalar» citando justo el mensaje con el que el agente pasó la
 * conversación a una persona, o «fuera del conocimiento» citando la pregunta
 * que el agente, con razón, le pasó al equipo. A SAMER (Rei, 21-10) eso le
 * puso en rojo 3 de 6 conversaciones de un agente que hizo lo correcto, y Rei
 * no deja activar al agente con un caso rojo.
 *
 * Aquí se descarta SOLO lo que el transcript desmiente. Una alucinación nunca:
 * aunque cite la pregunta del cliente, puede estar señalando lo que el agente
 * inventó al contestarla, y eso no se comprueba sin un modelo.
 * PURA: sin BD ni modelo.
 */

type Turno = { role: "cliente" | "agente"; text: string };
type Hallazgo = VerdictType["hallazgos"][number];

/** El juez copia la cita con el «CLIENTE:» del transcript, comillas o espacios de más. */
function normalizar(texto: string): string {
  return texto
    .normalize("NFC")
    .toLowerCase()
    .replace(/^\s*(cliente|agente)\s*:\s*/, "")
    .replace(/["«»“”]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** ¿La evidencia es una cita de este mensaje? Una paráfrasis no cuenta: se queda. */
function cita(evidencia: string, mensaje: string): boolean {
  const e = normalizar(evidencia);
  return e.length > 0 && normalizar(mensaje).includes(e);
}

export function descartarHallazgosImposibles(input: {
  veredicto: VerdictType;
  transcript: Turno[];
  /** La conversación terminó porque el agente la pasó a una persona. */
  traspaso: boolean;
}): VerdictType {
  const { veredicto, transcript, traspaso } = input;
  const delAgente = transcript.filter((t) => t.role === "agente");
  const delCliente = transcript.filter((t) => t.role === "cliente");
  // El intercambio que terminó en el traspaso: el último mensaje del cliente
  // y lo que el agente contestó al pasarlo.
  const desde = transcript.map((t) => t.role).lastIndexOf("cliente");
  const cierre = desde >= 0 ? transcript.slice(desde) : [];

  const desmentido = (h: Hallazgo): boolean => {
    const enAgente = delAgente.some((t) => cita(h.evidencia, t.text));
    const soloDelCliente = !enAgente && delCliente.some((t) => cita(h.evidencia, t.text));
    // El tono es el del agente: una cita que solo dijo el cliente no lo prueba.
    if (h.tipo === "tono") return soloDelCliente;
    // Salirse del conocimiento también es cosa del agente: la pregunta del
    // cliente no lo prueba, haya o no traspaso. Pasó con «kiero saber cuanto
    // cuesta», marcado aunque el agente contestó con el conocimiento; y pasar
    // al equipo lo que no está ahí es lo correcto. Si cita al agente, se queda.
    if (h.tipo === "fuera_de_kb") return soloDelCliente;
    if (!traspaso) return false;
    // Escaló justo ahí: «debió escalar» sobre ese mismo intercambio es falso.
    // Si cita un pedido ANTERIOR (escaló tarde), se queda.
    if (h.tipo === "debio_escalar") {
      return cierre.some((t) => cita(h.evidencia, t.text));
    }
    return false;
  };

  const hallazgos = veredicto.hallazgos.filter((h) => !desmentido(h));
  if (hallazgos.length === veredicto.hallazgos.length) return veredicto;
  // Sin nada en pie no queda de qué acusar: verde. Si algo queda, manda el juez.
  return { veredicto: hallazgos.length === 0 ? "verde" : veredicto.veredicto, hallazgos };
}

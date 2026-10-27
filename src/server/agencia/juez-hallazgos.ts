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
 * Aquí se descarta SOLO lo que el transcript desmiente. Una alucinación solo
 * cuando la cita es del agente y lo único que hace es derivar, sin una cifra:
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

/** Frases con que el agente pasa algo a una persona en vez de contestarlo. */
const DERIVA =
  /\b(te paso con|te paso a|te comunico con|te contacto con|lo maneja|la maneja|los maneja|las maneja|te (lo |la |los |las )?confirm|te (va a |van a )?(escrib|contact|llam|respond|contest)|coordin|con el equipo|una persona del equipo)/i;

/**
 * ¿La cita solo deriva? Sin cifras (precio, plazo, porcentaje, fecha) y con
 * una frase de derivar. Cualquier número la deja en pie: ahí sí pudo inventar.
 */
export function soloDeriva(evidencia: string): boolean {
  // «Vivienda 8», «Departamento 3B»: el nombre de la propiedad no es una cifra.
  const sinNombres = evidencia.replace(
    /\b(vivienda|casa|departamento|depto|depa|local|lote|unidad|torre|bloque)\s+\d+[a-z]?\b/gi,
    ""
  );
  return !/\d/.test(sinNombres) && DERIVA.test(evidencia);
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
    // Pasar al equipo lo que no sabe no inventa nada. Pasó en Rei (25-10):
    // «Te paso con Marcelo, que te va a dar los detalles exactos del
    // enganche» salió como alucinación. Solo si la cita es del agente, no trae
    // ni una cifra y lo único que hace es derivar.
    if (h.tipo === "alucinacion") return enAgente && soloDeriva(h.evidencia);
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

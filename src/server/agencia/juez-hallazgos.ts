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
  return !/\d/.test(sinNombres(evidencia)) && DERIVA.test(evidencia);
}

/** «Vivienda 8», «Departamento 3B»: el nombre de la propiedad no es una cifra. */
function sinNombres(texto: string): string {
  return texto.replace(
    /\b(vivienda|casa|departamento|depto|depa|local|lote|unidad|torre|bloque)\s+\d+[a-z]?\b/gi,
    ""
  );
}

const RELLENO = new Set(["y", "o", "de", "del", "la", "el", "los", "las", "a", "en", "con"]);

function plano(texto: string): string {
  return texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

/**
 * ¿Todos los datos de la cita están en el conocimiento? Un dato es una cifra:
 * las largas («120.000») o con letra («5B») tienen que aparecer tal cual; las
 * cortas («3») junto a la misma palabra («3 dormitorios»). Sin ningún dato no
 * se puede comprobar y el hallazgo se queda.
 */
export function datosEnConocimiento(evidencia: string, conocimiento: string): boolean {
  const ev = plano(sinNombres(evidencia));
  const kb = plano(conocimiento);
  const datos = [...ev.matchAll(/\d[\d.,]*\d|\d[a-z]?/g)];
  if (datos.length === 0) return false;
  return datos.every((m) => {
    const dato = m[0];
    const suelto = new RegExp(`(^|[^\\d.,a-z])${dato.replace(/[.]/g, "\\.")}($|[^\\d,a-z]|\\.(?!\\d))`);
    if (dato.length >= 4 || /[a-z]$/.test(dato)) return suelto.test(kb);
    // La palabra que sigue a la cifra corta, saltando «y», «de»…
    const despues = ev
      .slice((m.index ?? 0) + dato.length)
      .split(/[^a-z0-9ñ]+/)
      .filter((w) => w && !RELLENO.has(w) && !/^\d/.test(w));
    const palabra = despues[0]?.slice(0, 4);
    if (!palabra) return false;
    return new RegExp(`(^|[^\\d.,])${dato}\\s+${palabra}`).test(kb);
  });
}

export function descartarHallazgosImposibles(input: {
  veredicto: VerdictType;
  transcript: Turno[];
  /** La conversación terminó porque el agente la pasó a una persona. */
  traspaso: boolean;
  /** Lo que el juez recibió como conocimiento (P/R, bloques y catálogo). */
  conocimiento?: string;
}): VerdictType {
  const { veredicto, transcript, traspaso, conocimiento } = input;
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
    if (h.tipo === "fuera_de_kb") {
      if (soloDelCliente) return true;
      // Rei (27-10): «Las casas de Santorini arrancan en $us 120.000» salió
      // fuera del conocimiento, y la Vivienda 2 está ahí a $us 120.000.
      return enAgente && !!conocimiento && datosEnConocimiento(h.evidencia, conocimiento);
    }
    // Pasar al equipo lo que no sabe no inventa nada. Pasó en Rei (25-10):
    // «Te paso con Marcelo, que te va a dar los detalles exactos del
    // enganche» salió como alucinación. Solo si la cita es del agente, no trae
    // ni una cifra y lo único que hace es derivar.
    //
    // Rei (27-10): «cuesta $145.000 y tiene entrega para junio de 2027» salió
    // como alucinación con los dos datos en el catálogo; y «estoy interesado
    // en saber si es buena inversión», que lo escribió el cliente y el agente
    // solo pasó a Marcelo. La pregunta del cliente puede señalar lo que el
    // agente inventó al contestarla; si lo único que contestó fue el traspaso,
    // no inventó nada.
    if (h.tipo === "alucinacion") {
      if (soloDelCliente) {
        return (
          traspaso &&
          cierre.some((t) => t.role === "cliente" && cita(h.evidencia, t.text)) &&
          cierre.every((t) => t.role === "cliente" || soloDeriva(t.text))
        );
      }
      return (
        enAgente &&
        (soloDeriva(h.evidencia) || (!!conocimiento && datosEnConocimiento(h.evidencia, conocimiento)))
      );
    }
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

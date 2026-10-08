/**
 * Fork — «Enséñaselo a tu agente» (puro, probado).
 *
 * Cada vez que el agente pasa una pregunta y una persona del negocio la
 * contesta (desde la bandeja o desde el teléfono), esa respuesta es
 * conocimiento que el agente no tenía. Aquí se detectan esos momentos en el
 * hilo para ofrecer guardarlos como pregunta y respuesta con un toque: el
 * empleado aprende de su jefe en vez de volver a pasar la misma pregunta.
 */

export type HiloItem = {
  id: string;
  direction: "in" | "out";
  origin?: "ai" | "operator" | "manual" | "template" | null;
  type: string;
  text: string | null;
};

export type Momento = { question: string; answer: string };

/** "ok", "gracias", "ya te marco": eso no es conocimiento. */
const RESPUESTA_MIN = 15;
/** Una pregunta se arma con lo que el cliente dijo seguido, hasta tres mensajes. */
const PREGUNTA_MAX_MENSAJES = 3;

function esTexto(m: HiloItem): boolean {
  return (m.type === "text" || m.type === "button" || m.type === "interactive") && Boolean(m.text?.trim());
}

function esPersona(m: HiloItem): boolean {
  return m.direction === "out" && (m.origin === "operator" || m.origin === "manual");
}

/**
 * Para cada respuesta de una persona a lo último que preguntó el cliente
 * (con o sin un mensaje del agente en medio), la pregunta y la respuesta
 * sugeridas. Solo la primera respuesta humana después del cliente (las
 * siguientes suelen ser "¿algo más?").
 */
export function momentosParaEnsenar(hilo: HiloItem[]): Map<string, Momento> {
  const out = new Map<string, Momento>();
  for (let i = 0; i < hilo.length; i++) {
    const m = hilo[i]!;
    if (!esPersona(m) || !esTexto(m)) continue;
    const answer = m.text!.trim();
    if (answer.length < RESPUESTA_MIN) continue;
    // Hacia atrás se saltan los mensajes del agente (el "te paso con alguien"
    // del traspaso). Si antes del cliente aparece otra persona, esta no es la
    // primera respuesta humana: no se ofrece.
    let j = i - 1;
    while (j >= 0 && hilo[j]!.direction === "out" && !esPersona(hilo[j]!)) j--;
    const anterior = hilo[j];
    if (!anterior || anterior.direction !== "in" || !esTexto(anterior)) continue;
    const preguntas: string[] = [];
    for (; j >= 0 && preguntas.length < PREGUNTA_MAX_MENSAJES; j--) {
      const p = hilo[j]!;
      if (p.direction !== "in") break;
      if (esTexto(p)) preguntas.unshift(p.text!.trim());
    }
    if (preguntas.length === 0) continue;
    out.set(m.id, { question: preguntas.join(" ").slice(0, 500), answer: answer.slice(0, 4000) });
  }
  return out;
}

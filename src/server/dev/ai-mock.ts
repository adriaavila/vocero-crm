import { JUDGE_MARKER } from "@/server/ai/prompts";
import { ASK_MARKER } from "@/server/agencia/centro-ask-prompt";
import { BORRADOR_MARKER } from "@/server/agencia/borrador-negocio-prompt";
import { SEGUIMIENTO_MARKER } from "@/server/agencia/seguimiento-prompt";

/**
 * Proveedor LLM determinista para el self-test (contrato mocks.md).
 * Despacha por contenido del último mensaje `user` (o del system si es el
 * juez). JAMÁS es fallback en runtime: solo responde si OPENAI_BASE_URL
 * apunta explícitamente a él y el gate de mocks está activo.
 */

type InMessage = { role: string; content: string };

/** Lo que «oye» el mock en una nota de voz (también lo devuelve su whisper). */
export const MOCK_NOTA_DE_VOZ = "Hola, quería saber si atienden el sábado en la mañana";
/** Lo que «ve» el mock en una imagen. */
export const MOCK_IMAGEN = "Comprobante de transferencia por $450 a nombre de la clínica";

/** Fork — partes de audio/imagen (oír y ver); null si no hay ninguna. */
export function aiMockMedia(messages: { content: unknown }[]): string | null {
  for (const m of messages) {
    if (!Array.isArray(m.content)) continue;
    for (const part of m.content as { type?: string }[]) {
      if (part?.type === "input_audio") return MOCK_NOTA_DE_VOZ;
      if (part?.type === "image_url") return MOCK_IMAGEN;
    }
  }
  return null;
}

export function aiMockCompletion(messages: InMessage[]): string {
  const system = messages.find((m) => m.role === "system")?.content ?? "";
  const lastUser =
    [...messages].reverse().find((m) => m.role === "user")?.content ?? "";

  // Juez del Laboratorio: veredicto determinista por persona. Para cerrar el
  // loop del self-test, la persona fuera_de_kb pasa a verde si el CONOCIMIENTO
  // configurado ya cubre garantías/devoluciones (sugerencia aplicada).
  if (system.includes(JUDGE_MARKER)) {
    const kbSection =
      lastUser
        .split("CONOCIMIENTO CONFIGURADO:")[1]
        ?.split("TRANSCRIPT COMPLETO:")[0] ?? "";
    const kbCoversWarranty = /garant|devoluc/i.test(kbSection);
    if (lastUser.includes("fuera_de_kb") && !kbCoversWarranty) {
      return JSON.stringify({
        veredicto: "rojo",
        hallazgos: [
          {
            tipo: "fuera_de_kb",
            evidencia:
              "El cliente preguntó por garantías y devoluciones y el conocimiento no lo cubre.",
            sugerencia: {
              pregunta: "¿Cuál es la política de garantías y devoluciones?",
              respuesta:
                "Aceptamos devoluciones dentro de los 30 días con ticket de compra; la garantía depende del fabricante.",
            },
          },
        ],
      });
    }
    return JSON.stringify({ veredicto: "verde", hallazgos: [] });
  }

  // «Pregúntale a allok» (Inicio): contesta con cifras del SNAPSHOT que recibió,
  // así una prueba local ve que el resumen llega y es de la organización.
  if (system.includes(ASK_MARKER)) {
    return JSON.stringify({ answer: askMockAnswer(lastUser) });
  }

  // «Llénalo por mí»: reparte las frases del TEXTO en los campos, sin inventar.
  if (system.includes(BORRADOR_MARKER)) {
    return JSON.stringify(borradorMock(lastUser));
  }

  // Seguimiento: retoma si la última línea del cliente dejó algo abierto;
  // si se despidió o dio las gracias, no escribe.
  if (system.includes(SEGUIMIENTO_MARKER)) {
    const cliente = lastUser
      .split("\n")
      .filter((l) => l.startsWith("Cliente:"))
      .at(-1)
      ?.toLowerCase() ?? "";
    if (/gracias|chao|adi[oó]s|no me interesa/.test(cliente)) {
      return JSON.stringify({ send: false, text: "" });
    }
    return JSON.stringify({ send: true, text: "¿Pudiste revisarlo? Si quieres, te ayudo con el siguiente paso." });
  }

  const text = lastUser.toLowerCase();

  // Persona pide_humano (el regex de respaldo captura la frase canónica; esta
  // rama cubre variantes que llegan al modelo).
  if (text.includes("humano") || text.includes("asesor")) {
    return JSON.stringify({ action: "handoff", reason: "cliente" });
  }

  // Intención de compra → mover a Interesado.
  if (
    text.includes("lo compro") ||
    text.includes("quiero comprar") ||
    text.includes("me lo llevo")
  ) {
    return JSON.stringify({
      action: "move_stage",
      stage: "Interesado",
      reply: "¡Excelente! Te aparto el producto y un compañero te confirma el pago.",
    });
  }

  // Memoria del cliente (sistema aparte): «¿cuándo es mi cita?» se contesta
  // con la cita que el CRM le pasó, como lo haría un modelo de verdad.
  const memoria = messages.filter((m) => m.role === "system").slice(1).map((m) => m.content).join("\n");
  const cita = memoria.match(/Tiene una cita agendada el ([^\n]+?)\.(?:\n|$)/)?.[1];
  if (cita && /mi cita|a qu[eé] hora/.test(text)) {
    const nombre = memoria.match(/Se llama ([^\n]+?)\./)?.[1];
    return JSON.stringify({ action: "reply", text: `${nombre ? `${nombre}, tu` : "Tu"} cita es el ${cita}.` });
  }

  const eco = lastUser.slice(0, 80);
  return JSON.stringify({
    action: "reply",
    text: `Respuesta de prueba sobre: ${eco}`,
  });
}

function askMockAnswer(prompt: string): string {
  const question = prompt.split("\n\nSNAPSHOT:\n")[0]?.replace(/^Pregunta: /, "") ?? "";
  if (/clima|futbol|receta/i.test(question)) return "Eso no está en los datos de hoy.";
  try {
    const snap = JSON.parse(prompt.split("\n\nSNAPSHOT:\n")[1] ?? "{}") as {
      negocio?: string;
      hoy?: { conversaciones?: number };
      porAtender?: { teNecesitan?: number; total?: number; principales?: { contacto?: string; razon?: string }[] };
    };
    const first = snap.porAtender?.principales?.[0];
    return `[mock] ${snap.negocio ?? "Tu negocio"}: hoy ${snap.hoy?.conversaciones ?? 0} conversaciones y ${snap.porAtender?.teNecesitan ?? 0} te necesitan (de ${snap.porAtender?.total ?? 0} por atender).${first ? ` Empieza por ${first.contacto}: ${first.razon}.` : ""}`;
  } catch {
    return "[mock] No pude leer el resumen.";
  }
}

function borradorMock(prompt: string) {
  const source = prompt.split('"""')[1] ?? "";
  const sentences = source.split(/(?<!\b[A-Z][a-z]{0,2}\.)(?<=[.!?])\s+|\n+/).map((t) => t.trim()).filter(Boolean);
  const pick = (re: RegExp) => sentences.filter((t) => re.test(t)).join(" ");
  const precios = pick(/\$|precio|cuesta|cobra/i);
  const zona = pick(/calle|av\.|avenida|zona|direcci|colonia|envi/i);
  const oferta = sentences.filter((t) => !precios.includes(t) && !zona.includes(t)).slice(0, 2).join(" ");
  return { oferta, precios, zona, preguntas: [] };
}

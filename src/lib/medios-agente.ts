/**
 * Fork — cómo ve el agente (Rei) un mensaje que no es texto.
 *
 * Antes, el historial que recibía el modelo descartaba todo mensaje sin
 * `text`: una nota de voz, una foto con «¿cuánto cuesta esto?» en el pie o una
 * ubicación desaparecían, y el agente contestaba de nuevo el mensaje ANTERIOR.
 * Aquí cada mensaje se vuelve una línea que el modelo entiende: lo que dijo la
 * nota de voz (su transcripción), lo que se ve en la imagen, el pie de foto, el
 * nombre del documento… y, cuando no se pudo oír o ver, un aviso entre
 * corchetes que le dice qué hacer en vez de inventar.
 *
 * Puro: sin BD ni red (la transcripción la consigue `server/agencia/oir-y-ver`).
 */

export type MedioParaAgente = {
  kind: string;
  caption: string | null;
  fileName: string | null;
  payload: unknown;
};

export type MensajeParaAgente = {
  direction: "in" | "out";
  type: string;
  text: string | null;
  transcript: string | null;
};

const NOMBRE: Record<string, string> = {
  audio: "una nota de voz",
  image: "una imagen",
  video: "un video",
  document: "un documento",
  sticker: "un sticker",
  location: "una ubicación",
  contacts: "una tarjeta de contacto",
};

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function ubicacion(payload: unknown): string {
  const p = (payload ?? {}) as Record<string, unknown>;
  const partes = [str(p.name), str(p.address)].filter(Boolean);
  if (partes.length) return partes.join(", ");
  const lat = p.latitude;
  const lng = p.longitude;
  return typeof lat === "number" && typeof lng === "number" ? `${lat}, ${lng}` : "";
}

function contactos(payload: unknown): string {
  if (!Array.isArray(payload)) return "";
  return payload
    .map((c) => {
      const r = (c ?? {}) as { name?: { formatted_name?: unknown }; phones?: { phone?: unknown }[] };
      return [str(r.name?.formatted_name), str(r.phones?.[0]?.phone)].filter(Boolean).join(" ");
    })
    .filter(Boolean)
    .join("; ");
}

/** Une la etiqueta entre corchetes con el pie de foto, si lo hay. */
function con(etiqueta: string, pie: string | null): string {
  return pie ? `[${etiqueta}] ${pie}` : `[${etiqueta}]`;
}

/**
 * La línea con la que el agente ve este mensaje, o null si no hay nada que
 * mostrarle (un tipo desconocido sin texto).
 */
export function textoParaAgente(
  m: MensajeParaAgente,
  medio: MedioParaAgente | null | undefined
): string | null {
  const texto = str(m.text);
  if (!medio) return texto;
  const pie = str(medio.caption) ?? texto;
  const oido = str(m.transcript);

  if (m.direction === "out") {
    return con(`Se le envió ${NOMBRE[medio.kind] ?? "un adjunto"}`, pie);
  }

  switch (medio.kind) {
    case "audio":
      return oido
        ? `[Nota de voz] ${oido}`
        : "[Mandó una nota de voz que no se pudo escuchar. Pídele con amabilidad que te lo escriba.]";
    case "image":
      if (oido) return con(`Imagen: ${oido}`, pie);
      return pie
        ? con("Mandó una imagen que no puedes ver", pie)
        : "[Mandó una imagen que no puedes ver. Pregúntale qué necesita.]";
    case "document": {
      const nombre = str(medio.fileName);
      const etiqueta = `Documento${nombre ? ` «${nombre}»` : ""}${oido ? `: ${oido}` : ""}`;
      return con(etiqueta, pie);
    }
    case "video":
      return con("Mandó un video que no puedes ver", pie);
    case "sticker":
      return "[Sticker]";
    case "location": {
      const donde = ubicacion(medio.payload);
      return `[Ubicación${donde ? `: ${donde}` : ""}]`;
    }
    case "contacts": {
      const quien = contactos(medio.payload);
      return `[Tarjeta de contacto${quien ? `: ${quien}` : ""}]`;
    }
    default:
      return pie ?? texto;
  }
}

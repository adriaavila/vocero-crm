/**
 * Capa de agencia — «Desde tus chats»: el dueño exporta chats de WhatsApp
 * (Más opciones → Exportar chat, sin archivos) y su agente aprende de cómo él
 * ya contesta: precios, respuestas de siempre y su manera de escribir.
 *
 * Puro y sin servidor: corre en el navegador (lee el archivo, el dueño dice
 * quién es él y solo viaja el texto condensado) y en las pruebas. Lo que
 * sale de aquí ya no lleva nombres, teléfonos ni correos de los clientes.
 */

export type MensajeChat = { autor: string; texto: string };

/** Lo que llega al servidor: alcanza para unas cuantas conversaciones de verdad. */
export const CHAT_CONDENSADO_MAX = 16_000;
/** Un archivo exportado más grande que esto no es un chat de un negocio pequeño: se lee el final. */
export const CHAT_ARCHIVO_MAX_BYTES = 20 * 1024 * 1024;

const INVISIBLES = /[‎‏‪-‮⁦-⁩﻿]/g;

// [12/10/24, 15:03:22] Ana: hola         (iPhone)
// 12/10/24, 15:03 - Ana: hola            (Android)
// 12.10.24, 3:03 p. m. - Ana: hola       (Android en otros idiomas)
const ENCABEZADO =
  /^\[?(\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4}),?\s+(\d{1,2}:\d{2}(?::\d{2})?(?:\s?[ap]\.?\s?m\.?)?)\]?\s*(?:-|–)?\s*([^:]{1,80}?):\s?([\s\S]*)$/i;

/** Lo que WhatsApp pone en lugar de un archivo que no se exportó. */
const OMITIDO =
  /^<?(?:multimedia omitid[oa]|media omitted|archivo omitido|imagen omitida|image omitted|audio omitido|audio omitted|video omitido|video omitted|sticker omitido|sticker omitted|gif omitido|gif omitted|documento omitido|document omitted|se eliminó este mensaje|this message was deleted|eliminaste este mensaje|you deleted this message|null)>?\.?$/i;

/**
 * Los mensajes de un chat exportado. Un renglón sin encabezado continúa el
 * mensaje anterior; los avisos del sistema (cifrado, cambios de número) no
 * tienen autor y se quedan fuera.
 */
export function leerChatExportado(texto: string): MensajeChat[] {
  const mensajes: MensajeChat[] = [];
  let actual: MensajeChat | null = null;
  for (const crudo of texto.replace(INVISIBLES, "").split(/\r?\n/)) {
    const m = ENCABEZADO.exec(crudo.replace(/ | /g, " "));
    if (m) {
      actual = { autor: (m[3] ?? "").trim(), texto: (m[4] ?? "").trim() };
      mensajes.push(actual);
      continue;
    }
    // Un aviso del sistema también trae fecha, pero sin «autor:»: no continúa a nadie.
    if (/^\[?\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4},?\s+\d{1,2}:\d{2}/.test(crudo)) {
      actual = null;
      continue;
    }
    if (actual && crudo.trim()) actual.texto = `${actual.texto}\n${crudo.trim()}`;
  }
  return mensajes.filter((msg) => msg.autor && msg.texto && !OMITIDO.test(msg.texto));
}

/** Quién escribe en el chat, del que más al que menos. */
export function autoresDelChat(mensajes: MensajeChat[]): string[] {
  const cuenta = new Map<string, number>();
  for (const { autor } of mensajes) cuenta.set(autor, (cuenta.get(autor) ?? 0) + 1);
  return [...cuenta.entries()].sort((a, b) => b[1] - a[1]).map(([autor]) => autor);
}

/**
 * ¿Quién es el negocio? Con dos o más chats, el único que escribe en todos.
 * Con uno solo no se adivina: lo dice el dueño.
 */
export function adivinarNegocio(chats: MensajeChat[][]): string | null {
  if (chats.length < 2) return null;
  const [primero, ...resto] = chats.map((chat) => new Set(chat.map((m) => m.autor)));
  const comunes = [...(primero ?? [])].filter((autor) => resto.every((set) => set.has(autor)));
  return comunes.length === 1 ? (comunes[0] ?? null) : null;
}

/** Teléfonos, correos y enlaces de un cliente: el agente no los necesita para aprender. */
export function taparDatosDelCliente(texto: string): string {
  return texto
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "[correo]")
    .replace(/https?:\/\/\S+/g, "[enlace]")
    .replace(/\+?\d[\d\s().-]{7,}\d/g, "[teléfono]");
}

/**
 * Los chats como los lee el modelo: «Negocio:» lo que escribió el dueño,
 * «Cliente:» lo demás, sin nombres. Cada chat recibe la misma parte del cupo
 * y de cada uno se queda lo más reciente: es lo que mejor dice cómo contesta hoy.
 */
export function condensarChats(chats: MensajeChat[][], negocio: string, max = CHAT_CONDENSADO_MAX): string {
  const conNegocio = chats.filter((chat) => chat.some((m) => m.autor === negocio) && chat.some((m) => m.autor !== negocio));
  if (conNegocio.length === 0) return "";
  const cupo = Math.floor(max / conNegocio.length);
  const bloques = conNegocio.map((chat) => {
    // «Hola María»: el nombre del cliente tampoco viaja, ni en lo que escribió el negocio.
    const nombres = [...new Set(chat.filter((m) => m.autor !== negocio).flatMap((m) => m.autor.split(/\s+/)))]
      .filter((palabra) => /^\p{L}{3,}$/u.test(palabra))
      .map((palabra) => palabra.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    const sinNombres = nombres.length ? new RegExp(`(?<!\\p{L})(?:${nombres.join("|")})(?!\\p{L})`, "giu") : null;
    const lineas: string[] = [];
    let largo = 0;
    for (let i = chat.length - 1; i >= 0; i--) {
      const m = chat[i]!;
      const propio = m.autor === negocio ? m.texto : taparDatosDelCliente(m.texto);
      const texto = sinNombres ? propio.replace(sinNombres, "[cliente]") : propio;
      const linea = `${m.autor === negocio ? "Negocio" : "Cliente"}: ${texto.replace(/\s*\n\s*/g, " ").slice(0, 600)}`;
      if (largo + linea.length + 1 > cupo) break;
      lineas.unshift(linea);
      largo += linea.length + 1;
    }
    return lineas.join("\n");
  });
  return bloques.filter(Boolean).join("\n---\n");
}

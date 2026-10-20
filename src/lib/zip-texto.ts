/**
 * Capa de agencia — el .zip que entrega WhatsApp al exportar un chat desde el
 * iPhone (o desde Android con archivos) trae un `_chat.txt` adentro. Esto saca
 * ese texto en el navegador, sin librería: lee el directorio central del zip
 * y descomprime con `DecompressionStream`. Solo texto: fotos y audios ni se tocan.
 */

const FIRMA_FIN = 0x06054b50;
const FIRMA_CENTRAL = 0x02014b50;
const FIRMA_LOCAL = 0x04034b50;

/** Los .txt de un zip, del más grande al más chico. `null` si no es un zip que entendamos. */
export async function textosDelZip(buffer: ArrayBuffer): Promise<string[] | null> {
  const view = new DataView(buffer);
  let fin = -1;
  // El registro final mide 22 bytes más un comentario de hasta 64 KB.
  for (let i = buffer.byteLength - 22; i >= Math.max(0, buffer.byteLength - 22 - 65_535); i--) {
    if (view.getUint32(i, true) === FIRMA_FIN) {
      fin = i;
      break;
    }
  }
  if (fin < 0) return null;
  const total = view.getUint16(fin + 10, true);
  let p = view.getUint32(fin + 16, true);
  const entradas: { nombre: string; metodo: number; comprimido: number; local: number }[] = [];
  for (let n = 0; n < total && p + 46 <= buffer.byteLength; n++) {
    if (view.getUint32(p, true) !== FIRMA_CENTRAL) return null;
    const metodo = view.getUint16(p + 10, true);
    const comprimido = view.getUint32(p + 20, true);
    const largoNombre = view.getUint16(p + 28, true);
    const largoExtra = view.getUint16(p + 30, true);
    const largoComentario = view.getUint16(p + 32, true);
    const local = view.getUint32(p + 42, true);
    const nombre = new TextDecoder().decode(new Uint8Array(buffer, p + 46, largoNombre));
    entradas.push({ nombre, metodo, comprimido, local });
    p += 46 + largoNombre + largoExtra + largoComentario;
  }
  const textos = entradas
    .filter((e) => /\.txt$/i.test(e.nombre) && !e.nombre.startsWith("__MACOSX/"))
    .sort((a, b) => b.comprimido - a.comprimido);
  const salida: string[] = [];
  for (const entrada of textos) {
    if (view.getUint32(entrada.local, true) !== FIRMA_LOCAL) continue;
    const inicio = entrada.local + 30 + view.getUint16(entrada.local + 26, true) + view.getUint16(entrada.local + 28, true);
    const datos = new Uint8Array(buffer, inicio, entrada.comprimido);
    if (entrada.metodo === 0) {
      salida.push(new TextDecoder().decode(datos));
    } else if (entrada.metodo === 8) {
      const stream = new Blob([datos]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      salida.push(await new Response(stream).text());
    }
  }
  return salida;
}

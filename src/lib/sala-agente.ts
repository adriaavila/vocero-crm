/**
 * Qué casas del catálogo nombró el agente en su respuesta. PURA: sin BD.
 *
 * Leído en el Laboratorio de SAMER: el cliente pide «me pasan más info xfa» y
 * el agente le describe la casa con palabras. En WhatsApp lo que vende es la
 * foto, el precio y un botón. Cuando la respuesta nombra una o dos casas, Rei
 * manda la tarjeta de cada una justo después del texto.
 *
 * Reglas:
 *  - Se nombra una casa por su título completo, como palabra suelta, sin
 *    importar mayúsculas ni tildes («vivienda 2» no es «Vivienda 23»).
 *  - Una respuesta que nombra 3 casas o más es un menú: el cliente todavía
 *    no eligió, y tres tarjetas seguidas son spam. No se manda ninguna.
 *  - Una casa que ya recibió su tarjeta en este chat no se repite.
 */

export const MAX_TARJETAS_DEL_AGENTE = 2;

export type CasaCatalogo = { id: string; titulo: string };

export function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function casasNombradas(
  respuesta: string,
  catalogo: CasaCatalogo[],
  yaEnviadas: ReadonlySet<string> = new Set()
): CasaCatalogo[] {
  const texto = ` ${normalizar(respuesta)} `;
  const nombradas = catalogo.filter((casa) => {
    const titulo = normalizar(casa.titulo);
    // Un título de una sola palabra («Casa») aparece en cualquier respuesta.
    if (titulo.split(" ").length < 2) return false;
    return texto.includes(` ${titulo} `);
  });
  // Dos casas con títulos que se contienen («Vivienda 2» y «Vivienda 2 bis»):
  // si se nombró la larga, la corta no cuenta por estar dentro de ella.
  const sinContenidas = nombradas.filter(
    (casa) =>
      !nombradas.some(
        (otra) =>
          otra !== casa &&
          normalizar(otra.titulo).includes(normalizar(casa.titulo)) &&
          !texto.replace(` ${normalizar(otra.titulo)} `, " ").includes(` ${normalizar(casa.titulo)} `)
      )
  );
  if (sinContenidas.length === 0 || sinContenidas.length > MAX_TARJETAS_DEL_AGENTE) return [];
  return sinContenidas.filter((casa) => !yaEnviadas.has(casa.id));
}

/** El texto con que una tarjeta queda en la bandeja empieza por el título de la casa. */
export function tarjetaYaEnviada(textosDeTarjetas: string[], titulo: string): boolean {
  const t = normalizar(titulo);
  return textosDeTarjetas.some((texto) => normalizar(texto.split("\n")[0] ?? "") === t);
}

/**
 * Palabras que la sala de venta no puede mostrar.
 *
 * Las constructoras de Bolivia no pueden prometer un rendimiento sobre dinero
 * recibido del público sin que eso se lea como intermediación financiera (Ley
 * 393, ASFI). La guía comercial de SAMER las prohíbe en todo canal hasta que
 * un abogado apruebe la estructura; Rei las bloquea en lo que el dueño escribe
 * para la sala, en vez de confiar en que nadie se equivoque.
 *
 * PURA: se prueba sin BD.
 */
export const PALABRAS_PROHIBIDAS = [
  "renta",
  "rendimiento",
  "retorno",
  "interés",
  "ganancia",
  "utilidad",
  "inversión",
  "invertir",
  "plusvalía",
  "revalorización",
  "valorizar",
  "rentabilidad",
  "roi",
  "tir",
  "libre de riesgo",
  "subir de precio",
] as const;

const sinTildes = (texto: string) =>
  texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Las palabras prohibidas que aparecen en el texto (como palabra entera). */
export function palabrasProhibidas(texto: string): string[] {
  const limpio = sinTildes(texto);
  return PALABRAS_PROHIBIDAS.filter((palabra) => {
    const patron = sinTildes(palabra).replace(/ /g, "\\s+");
    return new RegExp(`(^|[^a-z0-9])${patron}s?([^a-z0-9]|$)`).test(limpio);
  });
}

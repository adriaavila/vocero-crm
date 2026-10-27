/**
 * Fork — las palabras que el dueño prohibió, cumplidas aunque el modelo se
 * olvide. PURA: sin BD ni modelo.
 *
 * SAMER escribió «Nunca usas las palabras renta, rendimiento, retorno…»
 * (Ley 393: hasta que lo apruebe un abogado). En el Laboratorio de Rei
 * (27-10) el agente igual contestó «lo del rendimiento del alquiler te lo
 * responde Marcelo». Una frase así, en WhatsApp con un cliente real, ya salió.
 * Aquí se leen las palabras de las instrucciones y se revisa cada respuesta
 * antes de mandarla; el pipeline le pide al modelo que la reescriba.
 */

/** Sin tildes y en minúsculas, para comparar «inversión» con «inversion». */
function plano(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/**
 * Lee las palabras prohibidas de las instrucciones del negocio: la lista que
 * sigue a «nunca uses / no uses / no digas … las palabras» hasta el punto, y
 * las frases entre comillas de una línea que empieza con «Nunca».
 */
export function palabrasProhibidas(instrucciones: string | null | undefined): string[] {
  if (!instrucciones) return [];
  const out = new Set<string>();
  for (const linea of instrucciones.split("\n")) {
    const lista =
      /\b(?:nunca|no|jam[aá]s|evita[rs]?)\s+(?:uses|usas|usar|digas|dices|decir|menciones|mencionas|mencionar|escribas|escribes)\s+(?:(?:las|los|estas|estos)\s+)?(?:palabras|t[eé]rminos)\s*:?\s*([^.\n]+)/i.exec(
        linea
      );
    if (lista?.[1]) {
      for (const w of lista[1].split(/,|;|\s+ni\s+|\s+y\s+|\s+o\s+/i)) {
        const limpia = w.replace(/["«»“”']/g, "").trim();
        if (limpia && limpia.split(/\s+/).length <= 3) out.add(limpia.toLowerCase());
      }
    }
    if (/^\s*[-•*]?\s*(nunca|no|jam[aá]s)\b/i.test(linea)) {
      for (const m of linea.matchAll(/["«“]([^"»”]{3,40})["»”]/g)) {
        if (m[1]) out.add(m[1].trim().toLowerCase());
      }
    }
  }
  return [...out];
}

/**
 * La primera palabra prohibida que usa el texto, o null. Palabra entera (con
 * plural): «renta» no salta en «parentesco», «interés» no salta en «te
 * interesa».
 */
export function usaProhibida(texto: string, prohibidas: string[]): string | null {
  const t = plano(texto);
  for (const p of prohibidas) {
    const escapada = plano(p).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
    if (new RegExp(`(^|[^a-z0-9ñ])${escapada}(e?s)?($|[^a-z0-9ñ])`).test(t)) return p;
  }
  return null;
}

/** Lo que se le dice al modelo para que reescriba la respuesta. */
export function pedidoDeReescritura(palabra: string): string {
  return `Tu respuesta anterior usó «${palabra}», que este negocio prohíbe. Reescríbela sin esa palabra ni otra de la lista prohibida de las instrucciones, con la misma acción y el mismo JSON.`;
}

/** Si ni reescrita sale limpia: se pasa a una persona con una frase neutra. */
export const DESPEDIDA_SIN_PROHIBIDAS =
  "Te paso con una persona del equipo para que te responda bien eso. Te escribe por aquí 🙂";

/**
 * Fork — recuperar clientes (puro, probado).
 *
 * El dinero más barato de un negocio pequeño es el cliente que ya vino una
 * vez y no volvió. Una persona del negocio le escribiría «hace tiempo que no
 * te vemos»; nadie lo hace porque nadie lleva la cuenta. Aquí viven las
 * reglas que no tocan la base: las opciones de Ajustes, la franja del día en
 * que se permite escribir, el tope diario y cómo se llenan las variables de
 * la plantilla. Fuera de las 24 h WhatsApp solo deja escribir con una
 * plantilla aprobada por Meta: por eso el ajuste trae una.
 */

/** Opciones del selector, en días sin saber del cliente. 0 = apagado. */
export const RECUPERAR_CHOICES = [0, 45, 60, 90, 180] as const;
export const RECUPERAR_RECOMENDADO = 90;
/**
 * Un día cuidadoso: muchas plantillas de marketing seguidas a gente que no
 * las espera bajan la calidad del número en Meta. Lo que no cabe hoy sale mañana.
 */
export const RECUPERAR_TOPE_DIA = 20;
/** De 10:00 a 19:00 en la zona del negocio: ni temprano ni de noche. */
export const RECUPERAR_DESDE = 10;
export const RECUPERAR_HASTA = 19;
/** Una plantilla con más variables que estas no sabemos llenarla sola. */
export const RECUPERAR_MAX_VARIABLES = 2;

/** El mensaje que se propone cuando el dueño no tiene uno aprobado. */
export const RECUPERAR_PLANTILLA = {
  name: "recuperar_clientes",
  language: "es",
  category: "MARKETING",
  body: "Hola {{1}}, hace tiempo que no sabemos de ti en {{2}}. ¿Te gustaría volver a agendar? Contesta este mensaje y te ayudamos.",
} as const;

export function normalizarRecuperar(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 365) return null;
  return n === 0 ? null : n;
}

export function recuperarLabel(dias: number): string {
  if (dias === 0) return "No les escribas";
  return `Les escribe a los ${dias} días sin saber de ellos${dias === RECUPERAR_RECOMENDADO ? " (recomendado)" : ""}`;
}

export function horaDeRecuperar(horaLocal: number): boolean {
  return horaLocal >= RECUPERAR_DESDE && horaLocal < RECUPERAR_HASTA;
}

/**
 * El primer nombre si parece un nombre; si no (un teléfono, un emoji, nada),
 * un saludo que se lee bien igual: Meta rechaza un parámetro vacío.
 */
export function primerNombre(nombre: string | null | undefined): string {
  const palabra = (nombre ?? "").trim().split(/\s+/)[0] ?? "";
  if (!/^\p{L}[\p{L}'’-]{1,29}$/u.test(palabra)) return "👋";
  return palabra.charAt(0).toLocaleUpperCase("es") + palabra.slice(1);
}

/** {{1}} el nombre del cliente, {{2}} el del negocio. `null` si no se puede llenar. */
export function variablesRecuperar(cuenta: number, cliente: string | null, negocio: string): string[] | null {
  if (cuenta > RECUPERAR_MAX_VARIABLES) return null;
  const valores = [primerNombre(cliente), negocio.trim() || "nuestro negocio"];
  return valores.slice(0, cuenta);
}

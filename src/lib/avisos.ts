import { plata } from "@/lib/lo-que-trajo";

/**
 * Fork — el texto de los avisos al celular (puro, probado). Se lee en la
 * pantalla bloqueada del teléfono: el título dice QUIÉN y QUÉ en pocas
 * palabras, el cuerpo trae lo que el cliente escribió para decidir sin abrir.
 */

export type Aviso =
  | { kind: "traspaso"; reason: string; nombre: string | null; ultimoMensaje: string | null }
  | { kind: "cita"; nombre: string | null; cuando: string };

const CUERPO_MAX = 140;

function recortar(texto: string): string {
  const limpio = texto.replace(/\s+/g, " ").trim();
  return limpio.length > CUERPO_MAX ? `${limpio.slice(0, CUERPO_MAX - 1).trimEnd()}…` : limpio;
}

function cita(texto: string | null): string | null {
  return texto?.trim() ? `«${recortar(texto)}»` : null;
}

export function textoAviso(aviso: Aviso): { title: string; body: string } {
  const quien = aviso.nombre?.trim() || "Un cliente";
  if (aviso.kind === "cita") {
    return { title: `Nueva cita: ${quien}`, body: `Agendada para ${aviso.cuando}.` };
  }
  const dijo = cita(aviso.ultimoMensaje);
  switch (aviso.reason) {
    case "cliente":
      return { title: `${quien} quiere hablar contigo`, body: dijo ?? "Pidió hablar con una persona." };
    case "hostilidad":
      return {
        title: `Conversación difícil con ${quien}`,
        body: "El agente se detuvo. Tú decides si contestar.",
      };
    case "error":
      return {
        title: `El agente no pudo contestarle a ${quien}`,
        body: dijo ? `Te espera: ${dijo}` : "Te espera una respuesta tuya.",
      };
    default:
      return {
        title: `${quien} necesita una respuesta tuya`,
        body: dijo ? `El agente no supo contestar: ${dijo}` : "El agente te pasó la conversación.",
      };
  }
}

/**
 * Los servicios de push de los navegadores. El servidor manda un POST a la URL
 * que dio el navegador: aceptar cualquiera dejaría que una sesión hiciera que
 * el servidor llame a donde quiera. Chrome/Android (FCM), Firefox, Safari/iOS
 * y Edge/Windows.
 */
const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/,
  /^android\.googleapis\.com$/,
  /^updates\.push\.services\.mozilla\.com$/,
  /(^|\.)push\.services\.mozilla\.com$/,
  /^web\.push\.apple\.com$/,
  /(^|\.)push\.apple\.com$/,
  /(^|\.)notify\.windows\.com$/,
];

export function endpointPermitido(endpoint: string, opts: { local?: boolean } = {}): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  // Solo el entorno de pruebas (mocks encendidos) acepta un "teléfono" local.
  if (opts.local && url.hostname === "localhost") return true;
  return PUSH_HOSTS.some((re) => re.test(url.hostname));
}

/** Fork — lo que hizo el agente hoy, para el resumen de la tarde. */
export type ResumenDia = {
  /** Clientes que escribieron hoy. */
  clientes: number;
  /** Mensajes que contestó el agente. */
  respuestas: number;
  /** Citas que agendó el agente hoy. */
  citas: number;
  /** Conversaciones que esperan a una persona ahora mismo. */
  teEsperan: number;
  /** Lo que valen esas citas, si el dueño dijo cuánto le deja una (`lib/lo-que-trajo.ts`). */
  valorCitasCents?: number | null;
  /** Ventas cerradas hoy y su monto en la moneda del negocio. */
  ventas?: { count: number; cents: number };
  currency?: string;
};

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

/**
 * `null` si hoy no pasó nada: un resumen en cero solo molesta. Con plata que
 * contar (citas con valor o ventas cerradas), la plata va primero: es lo que
 * el dueño quiere saber de su día, no cuántos mensajes se mandaron.
 */
export function textoResumenDia(r: ResumenDia): { title: string; body: string } | null {
  const ventas = r.ventas ?? { count: 0, cents: 0 };
  const moneda = r.currency ?? "USD";
  const valorCitas = r.citas > 0 ? (r.valorCitasCents ?? 0) : 0;
  if (r.clientes <= 0 && r.citas <= 0 && ventas.count <= 0) return null;
  const espera =
    r.teEsperan > 0
      ? `${r.teEsperan === 1 ? "1 conversación te espera" : `${r.teEsperan} conversaciones te esperan`}.`
      : "Nadie te espera.";

  if (valorCitas > 0 || ventas.count > 0) {
    const title =
      valorCitas > 0
        ? `Tu agente te trajo unos ${plata(valorCitas + ventas.cents, moneda)} hoy`
        : `Hoy cerraste ${plural(ventas.count, "venta", "ventas")}${ventas.cents > 0 ? ` por ${plata(ventas.cents, moneda)}` : ""}`;
    const partes: string[] = [];
    if (r.citas > 0) partes.push(`agendó ${plural(r.citas, "cita", "citas")}${valorCitas > 0 ? ` (${plata(valorCitas, moneda)})` : ""}`);
    if (valorCitas > 0 && ventas.count > 0) {
      partes.push(`cerraste ${plural(ventas.count, "venta", "ventas")}${ventas.cents > 0 ? ` (${plata(ventas.cents, moneda)})` : ""}`);
    }
    if (r.clientes > 0) partes.push(`te ${r.clientes === 1 ? "escribió" : "escribieron"} ${plural(r.clientes, "cliente", "clientes")}`);
    const primera = partes.join(", ");
    return { title, body: primera ? `${primera.charAt(0).toUpperCase()}${primera.slice(1)}. ${espera}` : espera };
  }

  const title =
    r.clientes > 0
      ? `Hoy te ${r.clientes === 1 ? "escribió" : "escribieron"} ${plural(r.clientes, "cliente", "clientes")}`
      : `Tu agente agendó ${plural(r.citas, "cita", "citas")} hoy`;
  const hizo: string[] = [];
  if (r.respuestas > 0) hizo.push(`tu agente contestó ${plural(r.respuestas, "mensaje", "mensajes")}`);
  if (r.citas > 0) hizo.push(`agendó ${plural(r.citas, "cita", "citas")}`);
  const primera = hizo.length ? `${hizo.join(" y ")}.` : "Tu agente no contestó ninguno.";
  return { title, body: `${primera.charAt(0).toUpperCase()}${primera.slice(1)} ${espera}` };
}


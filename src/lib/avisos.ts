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
};

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

/** `null` si hoy no escribió nadie: un resumen en cero solo molesta. */
export function textoResumenDia(r: ResumenDia): { title: string; body: string } | null {
  if (r.clientes <= 0) return null;
  const title = `Hoy te ${r.clientes === 1 ? "escribió" : "escribieron"} ${plural(r.clientes, "cliente", "clientes")}`;
  const hizo: string[] = [];
  if (r.respuestas > 0) hizo.push(`tu agente contestó ${plural(r.respuestas, "mensaje", "mensajes")}`);
  if (r.citas > 0) hizo.push(`agendó ${plural(r.citas, "cita", "citas")}`);
  const primera = hizo.length ? `${hizo.join(" y ")}.` : "Tu agente no contestó ninguno.";
  const espera =
    r.teEsperan > 0
      ? ` ${r.teEsperan === 1 ? "1 conversación te espera" : `${r.teEsperan} conversaciones te esperan`}.`
      : " Nadie te espera.";
  return { title, body: `${primera.charAt(0).toUpperCase()}${primera.slice(1)}${espera}` };
}

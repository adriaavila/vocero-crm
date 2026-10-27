/**
 * Fork — el gerente de ventas por WhatsApp: qué quiso decir el dueño y qué se
 * le contesta. PURO (sin BD ni reloj): `server/agencia/gerente.ts` trae las
 * cifras y manda.
 *
 * Las preguntas de siempre se contestan con datos, sin modelo: un dueño que
 * pregunta «¿cómo vamos?» todos los días no debería gastar IA ni esperar.
 * Solo lo que no encaja en ninguna va al modelo.
 */

import { cuandoCorto, type DatosVentas, type Sugerencia } from "@/lib/hermes-ventas";

export const CODIGO_PREFIJO = "REI";
export const CODIGO_MINUTOS = 30;

/** «REI 482913», «rei-482913», «482913» → «482913». */
export function codigoDeTexto(texto: string): string | null {
  const m = texto.trim().match(/^(?:rei[\s-]*)?(\d{6})$/i);
  return m ? m[1]! : null;
}

export type Intencion = "reporte" | "llamar" | "mejorar" | "casas" | "visitas" | "pausar" | "reanudar" | "ayuda" | "pregunta";

const sinTildes = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** El orden importa: «pausar reporte» es pausar, no reporte. */
const REGLAS: [Intencion, RegExp][] = [
  ["pausar", /\b(pausa|pausar|para|parar|deten|no me mandes|silencio|stop)\b.*\b(reporte|lunes|resumen)\b|^(pausa|stop)$/],
  ["reanudar", /\b(reanuda|reanudar|activa|activar|vuelve a mandar|retoma)\b.*\b(reporte|lunes|resumen)\b/],
  ["llamar", /\b(a quien|a quienes|llamo|llamar|llamamos|listos?|reserva|reservar|cerca de comprar|calientes?)\b/],
  ["mejorar", /\b(mejor\w*|sugerencia\w*|consejo\w*|que hago|que hacemos|que mejoro|que cambio|recomienda\w*)\b/],
  ["visitas", /\b(visita\w*|agenda|citas?)\b/],
  ["casas", /\b(casas?|inventario|unidades|departamentos?|deptos?|lotes?|disponibles?|vendidas?)\b/],
  ["reporte", /\b(reporte|resumen|como vamos|como va|como van|ventas|semana|numeros|cifras|estado)\b/],
  ["ayuda", /^(hola|buenas|buen dia|buenos dias|buenas tardes|buenas noches|menu|ayuda|\?|hey|ola)\b/],
];

export function intencionGerente(texto: string): Intencion {
  const t = sinTildes(texto).replace(/[¿?¡!.,]/g, " ").replace(/\s+/g, " ").trim();
  if (!t) return "ayuda";
  for (const [intencion, re] of REGLAS) if (re.test(t)) return intencion;
  return "pregunta";
}

/** Los botones de respuesta rápida (WhatsApp admite 3, de hasta 20 caracteres). */
export const BOTONES = [
  { id: "g:reporte", title: "Cómo vamos" },
  { id: "g:llamar", title: "A quién llamo" },
  { id: "g:mejorar", title: "Qué mejoro" },
] as const;

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

export function textoBienvenida(nombre: string, negocio: string): string {
  const primero = nombre.trim().split(/\s+/)[0] || nombre;
  return [
    `Listo, ${primero}. Soy tu gerente de ventas de *${negocio}*.`,
    "",
    "Pregúntame cuando quieras: «¿cómo vamos?», «¿a quién llamo hoy?», «¿qué casa no se mueve?». Y cada lunes a las 8 te mando el reporte de la semana.",
  ].join("\n");
}

export function textoDesconocido(): string {
  return [
    "Hola. Este es el WhatsApp de Rei para los dueños y vendedores de cada negocio.",
    "",
    "Para conectarte: entra a Rei, en *Inicio* toca «Conectar mi WhatsApp» y mándame el código que te aparece.",
  ].join("\n");
}

export function textoCodigoMalo(): string {
  return "Ese código no existe o ya venció (duran 30 minutos). Pide uno nuevo en Rei, en *Inicio* → «Conectar mi WhatsApp».";
}

export function textoAyuda(negocio: string): string {
  return [
    `Soy tu gerente de ventas de *${negocio}*. Puedes preguntarme:`,
    "• ¿Cómo vamos esta semana?",
    "• ¿A quién llamo hoy?",
    "• ¿Qué casa no se mueve?",
    "• ¿Qué visitas hay?",
    "• ¿Qué mejoro en el WhatsApp?",
    "",
    "O lo que quieras sobre tus clientes y tus ventas.",
  ].join("\n");
}

export function textoPausa(pausado: boolean): string {
  return pausado
    ? "Listo, no te mando más el reporte de los lunes. Escribe «activar reporte» para volver a recibirlo."
    : "Listo, cada lunes a las 8 te llega el reporte de la semana.";
}

export function textoLlamar(d: DatosVentas): string {
  const l: string[] = [];
  if (d.visitas.listos.length > 0) {
    l.push("*Llámalos hoy* (salieron de la visita con interés)");
    for (const v of d.visitas.listos.slice(0, 5)) l.push(`• ${v.contacto}${v.casa ? ` · ${v.casa}` : ""}`);
  }
  if (d.teEsperan.total > 0) {
    if (l.length) l.push("");
    l.push(`*Te esperan (${d.teEsperan.total})*`);
    for (const e of d.teEsperan.principales.slice(0, 5)) l.push(`• ${e.nombre} · ${e.razon.toLowerCase()} · ${e.ventana.toLowerCase()}`);
  }
  if (d.teEsperan.ventanaCerrada > 0) {
    if (l.length) l.push("");
    l.push(`Y ${plural(d.teEsperan.ventanaCerrada, "cliente ya cerró", "clientes ya cerraron")} su ventana de 24 h: solo con plantilla.`);
  }
  return l.length ? l.join("\n") : "Hoy nadie te espera y nadie salió de una visita con interés. Buen momento para revisar «qué mejoro».";
}

export function textoMejorar(sugerencias: Sugerencia[]): string {
  if (sugerencias.length === 0) return "Esta semana no veo nada que cambiar en el WhatsApp. Si algo te preocupa, pregúntame.";
  return ["*Qué haría esta semana*", ...sugerencias.slice(0, 5).map((s, n) => `${n + 1}. ${s.texto}`)].join("\n");
}

export function textoCasas(d: DatosVentas): string {
  if (d.casas.length === 0) return "No tienes propiedades cargadas en Rei todavía. Súbelas en *Propiedades* y te digo cuáles se mueven.";
  const l = [`*Casas de ${d.negocio}* · últimos ${d.dias} días`];
  const orden = [...d.casas].sort((a, b) => (a.estado === "cerrada" ? 1 : 0) - (b.estado === "cerrada" ? 1 : 0) || b.consultas + b.visitas * 3 - (a.consultas + a.visitas * 3));
  for (const c of orden) {
    const icono = c.estado === "cerrada" ? "⚫" : c.estado === "apartada" ? "🟡" : c.consultas + c.visitas > 0 ? "🟢" : "⚪";
    const partes = c.estado === "cerrada" ? ["vendida"] : [c.estado === "apartada" ? "apartada" : null, c.consultas > 0 ? plural(c.consultas, "consulta", "consultas") : "sin consultas", c.visitas > 0 ? plural(c.visitas, "visita", "visitas") : null].filter(Boolean);
    l.push(`${icono} ${c.titulo} · ${partes.join(" · ")}`);
  }
  return l.join("\n");
}

export function textoVisitas(d: DatosVentas): string {
  const l: string[] = [];
  if (d.visitas.proximas.length > 0) {
    l.push("*Próximas visitas*");
    for (const v of d.visitas.proximas) l.push(`• ${cuandoCorto(v.cuando)} · ${v.contacto}${v.casa ? ` · ${v.casa}` : ""}`);
  } else {
    l.push("No hay visitas agendadas para los próximos 7 días.");
  }
  if (d.visitas.sinResultado.length > 0) {
    l.push("", "*Sin resultado anotado*");
    for (const v of d.visitas.sinResultado) l.push(`• ${v.contacto}${v.casa ? ` · ${v.casa}` : ""} (${cuandoCorto(v.cuando)})`);
  }
  return l.join("\n");
}

/** Una línea para la plantilla del lunes, cuando la ventana de 24 h está cerrada. */
export function lineaPlantilla(d: DatosVentas): string {
  const partes = [plural(d.periodo.conversaciones, "cliente escribió", "clientes escribieron")];
  const visitas = d.casas.reduce((a, c) => a + c.visitas, 0);
  if (visitas > 0) partes.push(plural(visitas, "visita", "visitas"));
  if (d.visitas.listos.length > 0) partes.push(`${d.visitas.listos.length} para llamar hoy`);
  return partes.join(", ");
}

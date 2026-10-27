/**
 * Fork — el reporte de ventas que lee Hermes (el agente personal del operador,
 * en el VPS) y que manda al celular del dueño.
 *
 * PURO: recibe las cifras ya contadas (`server/agencia/hermes-ventas.ts`) y
 * devuelve sugerencias y texto. Sin BD ni reloj, para probarlo en Vitest y
 * para que cada sugerencia se pueda auditar contra el número que la disparó.
 *
 * El embudo va en `datos` pero no en el texto: casas, visitas y a quién llamar
 * ya lo dicen en palabras, y un reporte largo se deja de leer.
 *
 * La regla de las sugerencias: cada una nombra QUÉ hacer y DÓNDE, con el dato
 * que la justifica. Ninguna se inventa: sin el dato, no hay sugerencia.
 */

export type CasaVentas = {
  titulo: string;
  estado: "disponible" | "apartada" | "cerrada";
  precioCents: number;
  moneda: string;
  /** Conversaciones del periodo en las que el agente mostró esta casa. */
  consultas: number;
  /** Visitas del periodo (agendadas o hechas). */
  visitas: number;
};

export type EsperaVentas = { nombre: string; razon: string; ventana: string };

export type VisitaVentas = { cuando: string; contacto: string; casa: string | null };

export type DatosVentas = {
  negocio: string;
  zona: string;
  /** Días locales del periodo, «2026-10-20». */
  desde: string;
  hasta: string;
  dias: number;
  agenteEncendido: boolean;
  periodo: { conversaciones: number; leadsNuevos: number; respondioAgente: number; respondieronPersonas: number };
  anterior: { conversaciones: number; leadsNuevos: number };
  ventas: { cerradas: number; cents: number; moneda: string };
  embudo: { etapa: string; kind: "open" | "won" | "lost"; leads: number }[];
  casas: CasaVentas[];
  visitas: {
    proximas: VisitaVentas[];
    realizadas: number;
    noShow: number;
    /** Ya pasaron y nadie anotó cómo fueron. */
    sinResultado: VisitaVentas[];
    interesados: number;
    quierenNegociar: number;
    /** Salieron de la visita interesados o queriendo negociar: a quién llamar hoy. */
    listos: VisitaVentas[];
  };
  teEsperan: { total: number; ventanaCerrada: number; principales: EsperaVentas[] };
  /** Lo último que dijo el cliente antes de que el agente pasara la conversación por no saber. */
  noSupoResponder: { contacto: string; pregunta: string }[];
  pidieronPersona: number;
  laboratorio: { score: number; cuando: string } | null;
  fallosMarcados: number;
};

export type Sugerencia = { clave: string; texto: string };

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;
const cita = (s: string, max = 70) => {
  const t = s.replace(/\s+/g, " ").trim();
  return `«${t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t}»`;
};
const LAB_MINIMO = 80;
export const SUGERENCIAS_MAX = 3;

/** En orden de lo que más plata mueve primero; se muestran las primeras `SUGERENCIAS_MAX`. */
export function sugerenciasVentas(d: DatosVentas): Sugerencia[] {
  const out: Sugerencia[] = [];
  const p = d.periodo;

  if (d.visitas.listos.length > 0) {
    const nombres = d.visitas.listos.slice(0, 3).map((v) => v.contacto).join(", ");
    out.push({
      clave: "llamar_hoy",
      texto: `Llama hoy a ${nombres}: ${d.visitas.listos.length === 1 ? "salió" : "salieron"} de la visita con interés. Un día de espera enfría una reserva.`,
    });
  }

  if (!d.agenteEncendido && p.conversaciones > 0) {
    const lab = d.laboratorio
      ? d.laboratorio.score >= LAB_MINIMO
        ? ` La última prueba del Laboratorio sacó ${d.laboratorio.score}: ya se puede encender en «Activar».`
        : ` Para encenderlo hace falta una prueba del Laboratorio con ${LAB_MINIMO} o más (la última: ${d.laboratorio.score}).`
      : " Primero hay que correr una prueba en el Laboratorio.";
    out.push({
      clave: "agente_apagado",
      texto: `El agente sigue apagado: ${plural(p.conversaciones, "cliente escribió", "clientes escribieron")} y tu equipo contestó ${plural(p.respondieronPersonas, "mensaje", "mensajes")} a mano.${lab}`,
    });
  }

  if (d.noSupoResponder.length > 0) {
    const ej = d.noSupoResponder.slice(0, 2).map((q) => cita(q.pregunta, 60)).join(" y ");
    out.push({
      clave: "ensenar",
      texto: `El agente pasó ${plural(d.noSupoResponder.length, "pregunta que no supo contestar", "preguntas que no supo contestar")}, como ${ej}. Contéstalas una vez en la bandeja y toca «Enséñaselo a tu agente»: la próxima la responde solo.`,
    });
  }

  if (d.visitas.sinResultado.length > 0) {
    const v = d.visitas.sinResultado[0]!;
    const resto = d.visitas.sinResultado.length - 1;
    out.push({
      clave: "resultado_visita",
      texto: `Anota cómo fue la visita de ${v.contacto}${v.casa ? ` a ${v.casa}` : ""}${resto > 0 ? ` y ${plural(resto, "más", "más")}` : ""}: «interesado» o «quiere negociar» es lo que dice qué casa está por venderse.`,
    });
  }

  const abiertas = d.teEsperan.total;
  if (abiertas > 0) {
    const primero = d.teEsperan.principales[0];
    out.push({
      clave: "te_esperan",
      texto: `${plural(abiertas, "cliente espera", "clientes esperan")} a una persona con la ventana abierta.${primero ? ` Empieza por ${primero.nombre} (${primero.razon.toLowerCase()}; ${primero.ventana.toLowerCase()}).` : ""}`,
    });
  }

  if (d.teEsperan.ventanaCerrada > 0) {
    out.push({
      clave: "reactivar",
      texto: `${plural(d.teEsperan.ventanaCerrada, "cliente ya cerró", "clientes ya cerraron")} su ventana de 24 h sin respuesta: solo se les puede escribir con una plantilla aprobada. Una novedad real (avance de obra, casa que se apartó) es la excusa para volver a hablarles.`,
    });
  }

  const disponibles = d.casas.filter((c) => c.estado === "disponible");
  const conConsultas = disponibles.filter((c) => c.consultas > 0);
  const quietas = disponibles.filter((c) => c.consultas === 0);
  if (conConsultas.length > 0 && quietas.length > 0) {
    const top = [...conConsultas].sort((a, b) => b.consultas - a.consultas)[0]!;
    const nombres = quietas.slice(0, 3).map((c) => c.titulo).join(", ");
    out.push({
      clave: "casas_quietas",
      texto: `${nombres} no ${quietas.length === 1 ? "tuvo" : "tuvieron"} ninguna consulta, y ${top.titulo} tuvo ${top.consultas}. Revisa la foto de portada y si salen en el anuncio.`,
    });
  }

  if (d.visitas.proximas.length === 0 && p.conversaciones >= 5) {
    out.push({
      clave: "sin_visitas",
      texto: `Nadie tiene visita agendada para los próximos días con ${plural(p.conversaciones, "cliente", "clientes")} escribiendo. Que el agente ofrezca visita apenas alguien pregunte el precio.`,
    });
  }

  if (d.pidieronPersona >= 3) {
    out.push({
      clave: "pidieron_persona",
      texto: `${plural(d.pidieronPersona, "cliente pidió", "clientes pidieron")} hablar con una persona. Si es por precio o plan de pago, conviene que eso esté en lo que sabe el agente.`,
    });
  }

  if (d.fallosMarcados > 0) {
    out.push({
      clave: "fallos",
      texto: `Marcaste ${plural(d.fallosMarcados, "respuesta", "respuestas")} del agente como fallo: están en «Cómo decidió el agente» para corregirlas.`,
    });
  }

  return out;
}

/** «2026-10-20» → «20 oct». */
function diaCorto(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const mes = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"][m - 1];
  return `${d} ${mes}`;
}

/** «2026-10-24 10:00» → «24 oct, 10:00». */
function cuandoCorto(stamp: string): string {
  const [dia, hora] = stamp.split(" ");
  return dia ? `${diaCorto(dia)}${hora ? `, ${hora}` : ""}` : stamp;
}

function delta(actual: number, antes: number, dias: number): string {
  const dif = actual - antes;
  const antesTexto = dias === 7 ? "la semana pasada" : `los ${dias} días anteriores`;
  if (dif === 0) return `igual que ${antesTexto}`;
  return `${dif > 0 ? "+" : ""}${dif} vs. ${antesTexto}`;
}

function plata(cents: number, moneda: string): string {
  try {
    return new Intl.NumberFormat("es-BO", { style: "currency", currency: moneda, maximumFractionDigits: 0 }).format(cents / 100);
  } catch {
    return `${Math.round(cents / 100)} ${moneda}`;
  }
}

export type Formato = "whatsapp" | "telegram";

/**
 * El reporte para leer en el celular. `whatsapp` usa *negrita* de WhatsApp;
 * `telegram` usa HTML (`parse_mode=HTML`), con el texto del negocio escapado.
 */
export function textoReporteVentas(d: DatosVentas, sugerencias: Sugerencia[], formato: Formato = "whatsapp"): string {
  const esc = formato === "telegram" ? (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;") : (s: string) => s;
  const b = (s: string) => (formato === "telegram" ? `<b>${s}</b>` : `*${s}*`);
  const i = (s: string) => (formato === "telegram" ? `<i>${s}</i>` : `_${s}_`);
  const p = d.periodo;
  const lineas: string[] = [];

  lineas.push(b(`${esc(d.negocio)} · ventas`));
  lineas.push(`${diaCorto(d.desde)} al ${diaCorto(d.hasta)}`);
  lineas.push("");

  if (d.ventas.cerradas > 0) {
    lineas.push(`🔑 ${b(`${plural(d.ventas.cerradas, "venta cerrada", "ventas cerradas")}`)}${d.ventas.cents > 0 ? ` por ${plata(d.ventas.cents, d.ventas.moneda)}` : ""}`);
  }
  lineas.push(`💬 ${b(plural(p.conversaciones, "cliente escribió", "clientes escribieron"))} (${delta(p.conversaciones, d.anterior.conversaciones, d.dias)})`);
  const visitasPeriodo = d.casas.reduce((a, c) => a + c.visitas, 0);
  lineas.push(
    `🆕 ${plural(p.leadsNuevos, "lead nuevo", "leads nuevos")} · 🏠 ${plural(visitasPeriodo, "visita", "visitas")}` +
      (d.visitas.interesados + d.visitas.quierenNegociar > 0
        ? ` · 🔥 ${d.visitas.interesados + d.visitas.quierenNegociar} con interés`
        : ""),
  );

  if (d.casas.length > 0) {
    // Una línea por casa que se movió; las quietas y las vendidas, juntas: con
    // 8 casas, 8 renglones iguales se dejan de leer.
    lineas.push("", b("Casas"));
    const movidas = d.casas.filter((c) => c.estado !== "cerrada" && (c.consultas > 0 || c.visitas > 0 || c.estado === "apartada"));
    for (const c of [...movidas].sort((x, y) => y.consultas + y.visitas * 3 - (x.consultas + x.visitas * 3))) {
      const partes = c.estado === "apartada" ? ["apartada"] : [];
      if (c.consultas > 0) partes.push(plural(c.consultas, "consulta", "consultas"));
      if (c.visitas > 0) partes.push(plural(c.visitas, "visita", "visitas"));
      lineas.push(`${c.estado === "apartada" ? "🟡" : "🟢"} ${esc(c.titulo)} · ${partes.join(" · ")}`);
    }
    const quietas = d.casas.filter((c) => c.estado === "disponible" && c.consultas === 0 && c.visitas === 0);
    if (quietas.length > 0) lineas.push(`⚪ Sin consultas: ${esc(quietas.map((c) => c.titulo).join(", "))}`);
    const vendidas = d.casas.filter((c) => c.estado === "cerrada");
    if (vendidas.length > 0) lineas.push(`⚫ Vendidas: ${esc(vendidas.map((c) => c.titulo).join(", "))}`);
  }

  if (d.visitas.listos.length > 0) {
    lineas.push("", b("Llámalos hoy"));
    for (const v of d.visitas.listos.slice(0, 3)) {
      lineas.push(`• ${esc(v.contacto)}${v.casa ? ` · ${esc(v.casa)}` : ""} · visitó el ${cuandoCorto(v.cuando)}`);
    }
  }

  if (d.teEsperan.total > 0) {
    lineas.push("", b(`Te esperan (${d.teEsperan.total})`));
    for (const e of d.teEsperan.principales.slice(0, 3)) {
      lineas.push(`• ${esc(e.nombre)} · ${esc(e.razon.toLowerCase())} · ${esc(e.ventana.toLowerCase())}`);
    }
  }

  if (d.visitas.proximas.length > 0) {
    lineas.push("", b("Próximas visitas"));
    for (const v of d.visitas.proximas.slice(0, 4)) {
      lineas.push(`• ${cuandoCorto(v.cuando)} · ${esc(v.contacto)}${v.casa ? ` · ${esc(v.casa)}` : ""}`);
    }
  }

  const top = sugerencias.slice(0, SUGERENCIAS_MAX);
  if (top.length > 0) {
    lineas.push("", b("Qué haría esta semana"));
    top.forEach((s, n) => lineas.push(`${n + 1}. ${esc(s.texto)}`));
  }

  const pie = [`Agente ${d.agenteEncendido ? "encendido" : "apagado"}`];
  if (d.laboratorio) pie.push(`Laboratorio ${d.laboratorio.score}/100`);
  lineas.push("", i(pie.join(" · ")));
  return lineas.join("\n");
}

import { formatoMonto, fraseAlquiler, type Calculo } from "@/lib/sala-cuotas";

/**
 * La sala de venta dentro de WhatsApp, en piezas PURAS: qué dice cada mensaje,
 * qué botones lleva y cómo se lee lo que el comprador toca o escribe. Sin BD
 * ni red: el que envía es `server/agencia/sala-whatsapp.ts`.
 *
 * Límites de Meta que se respetan aquí y no en el envío: título de botón
 * hasta 20 caracteres, hasta 3 botones, cuerpo hasta 1024, pie hasta 60.
 */

export const LIMITE_TITULO_BOTON = 20;
export const LIMITE_CUERPO = 1024;
export const LIMITE_PIE = 60;

/** Lo que puede pedir un botón de la sala. El id viaja ida y vuelta por Meta. */
export type BotonSala =
  | { accion: "visita"; casaId: string }
  | { accion: "cuota"; casaId: string }
  | { accion: "sinalquiler"; casaId: string }
  | { accion: "cuando"; casaId: string; cuando: Cuando };

export const CUANDO = {
  semana: "Esta semana",
  finde: "El fin de semana",
  llamar: "Que me llamen",
} as const;
export type Cuando = keyof typeof CUANDO;

const PREFIJO = "sala";

export function idBoton(boton: BotonSala): string {
  return boton.accion === "cuando"
    ? `${PREFIJO}:cuando:${boton.casaId}:${boton.cuando}`
    : `${PREFIJO}:${boton.accion}:${boton.casaId}`;
}

/** null si el id no es de la sala (otro botón, una plantilla vieja, basura). */
export function leerBoton(id: string | null | undefined): BotonSala | null {
  if (!id) return null;
  const partes = id.split(":");
  if (partes[0] !== PREFIJO) return null;
  const [, accion, casaId, extra] = partes;
  if (!casaId || !/^[\w-]{1,64}$/.test(casaId)) return null;
  if (accion === "visita" || accion === "cuota" || accion === "sinalquiler") {
    return partes.length === 3 ? { accion, casaId } : null;
  }
  if (accion === "cuando" && extra && extra in CUANDO && partes.length === 4) {
    return { accion, casaId, cuando: extra as Cuando };
  }
  return null;
}

export type CasaWhatsapp = {
  id: string;
  titulo: string;
  precio: number;
  moneda: string;
  dormitorios: number | null;
  banos: number | null;
  superficie: number | null;
  estado: string;
};

const numero = (n: number) => n.toLocaleString("es-BO", { maximumFractionDigits: 2 });

function recortar(texto: string, max: number): string {
  return texto.length <= max ? texto : `${texto.slice(0, max - 1).trimEnd()}…`;
}

function boton(id: string, titulo: string) {
  return { type: "reply", reply: { id, title: recortar(titulo, LIMITE_TITULO_BOTON) } };
}

function cabeceraImagen(url: string | null) {
  return url ? { header: { type: "image", image: { link: url } } } : {};
}

function pie(negocio: string) {
  return negocio ? { footer: { text: recortar(negocio, LIMITE_PIE) } } : {};
}

/** «3 dorm. · 2,5 baños · 148,1 m²» — lo que cabe en un renglón de celular. */
export function rasgosCasa(casa: CasaWhatsapp): string {
  return [
    casa.dormitorios !== null ? `${casa.dormitorios} dorm.` : null,
    casa.banos !== null ? `${numero(casa.banos)} baños` : null,
    casa.superficie !== null ? `${numero(casa.superficie)} m²` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

export type MensajeInteractivo = {
  /** El objeto `interactive` del payload de Graph. */
  interactive: Record<string, unknown>;
  /** Cómo se ve en la bandeja del CRM, que no dibuja botones. */
  texto: string;
};

/** Una tarjeta por casa: foto, precio, rasgos y dos botones. */
export function tarjetaCasa(
  casa: CasaWhatsapp,
  opciones: { fotoUrl: string | null; conCalculo: boolean; negocio: string }
): MensajeInteractivo {
  const estado = casa.estado === "apartada" ? "\n_Apartada: pregúntanos si se libera._" : "";
  const cuerpo = recortar(
    [`*${casa.titulo}*`, formatoMonto(casa.precio, casa.moneda), rasgosCasa(casa)]
      .filter(Boolean)
      .join("\n") + estado,
    LIMITE_CUERPO
  );
  const botones = [boton(idBoton({ accion: "visita", casaId: casa.id }), "Quiero visitar")];
  if (opciones.conCalculo) {
    botones.push(boton(idBoton({ accion: "cuota", casaId: casa.id }), "Ver lo que pagaría"));
  }
  return {
    interactive: {
      type: "button",
      ...cabeceraImagen(opciones.fotoUrl),
      body: { text: cuerpo },
      ...pie(opciones.negocio),
      action: { buttons: botones },
    },
    texto: `${cuerpo.replace(/\*/g, "")}\n[${botones.map((b) => b.reply.title).join("] [")}]`,
  };
}

/** El saludo que abre la sala por WhatsApp. Texto libre: dentro de las 24 h. */
export function saludoWhatsapp(nombre: string | null, casas: number, negocio: string): string {
  const hola = nombre ? `Hola, ${nombre.split(" ")[0]}.` : "Hola.";
  const cuales = casas === 1 ? "la casa que te sirve" : `las ${casas} casas que te sirven`;
  return `${hola} Te armé ${cuales} según lo que nos contaste${negocio ? ` en ${negocio}` : ""}. Toca «Ver lo que pagaría» y te hago el cálculo aquí mismo.`;
}

/** El cierre con el link: la sala completa, con fotos y papeles. */
export function linkSalaCompleta(url: string, negocio: string): MensajeInteractivo {
  const cuerpo = "Si quieres ver todas las fotos y tu cálculo completo, está en tu sala:";
  return {
    interactive: {
      type: "cta_url",
      body: { text: cuerpo },
      ...pie(negocio),
      action: { name: "cta_url", parameters: { display_text: "Ver tu sala completa", url } },
    },
    texto: `${cuerpo}\n${url}`,
  };
}

type Pago = { mes: number; etiqueta: string; monto: number };

/** Las cuotas mensuales iguales van en un renglón ("12 × US$ 3.000"), no en doce. */
export function agruparPagos(pagos: Pago[]) {
  const filas: { etiqueta: string; monto: number; veces: number; desde: number; hasta: number }[] = [];
  for (const pago of pagos) {
    const base = pago.etiqueta.replace(/ \d+ de \d+$/, "");
    const previa = filas[filas.length - 1];
    if (previa && previa.etiqueta === base && Math.abs(previa.monto - pago.monto) < 0.01 && pago.mes === previa.hasta + 1) {
      previa.veces += 1;
      previa.hasta = pago.mes;
      continue;
    }
    filas.push({ etiqueta: base, monto: pago.monto, veces: 1, desde: pago.mes, hasta: pago.mes });
  }
  return filas.map((f) => ({
    ...f,
    cuando: f.veces > 1 ? `del mes ${f.desde} al ${f.hasta}` : f.desde === 0 ? "al reservar" : `mes ${f.desde}`,
  }));
}

/**
 * La respuesta a «Ver lo que pagaría»: la imagen del cálculo arriba y, debajo,
 * lo que la imagen no dice (la frase del alquiler, el plan). Sin imagen, los
 * pagos van en texto. Si todavía no sabemos su alquiler, se lo pregunta en el
 * mismo mensaje.
 */
export function mensajeCuota(input: {
  casa: CasaWhatsapp;
  calculo: Calculo;
  plan: { nombre: string; aprobadoPor: string | null };
  imagenUrl: string | null;
  sabeAlquiler: boolean;
  negocio: string;
}): MensajeInteractivo {
  const { casa, calculo } = input;
  const fmt = (n: number) => formatoMonto(n, casa.moneda);
  const renglones = agruparPagos(calculo.pagos).map(
    (p) => `• ${p.etiqueta}, ${p.cuando}: ${p.veces > 1 ? `${p.veces} × ` : ""}${fmt(p.monto)}`
  );
  const frase = fraseAlquiler(calculo, casa.moneda);
  const moneda = casa.moneda === "BOB" ? "en bolivianos" : "en dólares";
  const pregunta = input.sabeAlquiler
    ? null
    : `¿Cuánto pagas hoy de alquiler al mes, ${moneda}? Escríbeme el número y lo sumo a tu cálculo.`;
  const cuerpo = recortar(
    [
      `*${casa.titulo}* · ${fmt(casa.precio)}`,
      // Con imagen, los pagos ya están en ella: repetirlos alarga el chat.
      ...(input.imagenUrl ? [] : ["", ...renglones, `*Total: ${fmt(calculo.total)}*`]),
      ...(frase ? ["", frase] : []),
      "",
      `Plan «${input.plan.nombre}»${input.plan.aprobadoPor ? `, aprobado por ${input.plan.aprobadoPor}` : ""}. Los montos se confirman en el contrato de reserva.`,
      ...(pregunta ? ["", pregunta] : []),
    ].join("\n"),
    LIMITE_CUERPO
  );
  const botones = [boton(idBoton({ accion: "visita", casaId: casa.id }), "Quiero visitar")];
  if (!input.sabeAlquiler) {
    botones.push(boton(idBoton({ accion: "sinalquiler", casaId: casa.id }), "No pago alquiler"));
  }
  return {
    interactive: {
      type: "button",
      ...cabeceraImagen(input.imagenUrl),
      body: { text: cuerpo },
      ...pie(input.negocio),
      action: { buttons: botones },
    },
    texto: `${cuerpo.replace(/\*/g, "")}\n[${botones.map((b) => b.reply.title).join("] [")}]`,
  };
}

/** «Quiero visitar» → ¿cuándo? Tres respuestas rápidas, nada que escribir. */
export function preguntaCuando(casa: CasaWhatsapp, negocio: string): MensajeInteractivo {
  const cuerpo = `¡Bien! ¿Cuándo te queda mejor ir a ver *${casa.titulo}*?`;
  const botones = (Object.keys(CUANDO) as Cuando[]).map((c) =>
    boton(idBoton({ accion: "cuando", casaId: casa.id, cuando: c }), CUANDO[c])
  );
  return {
    interactive: { type: "button", body: { text: cuerpo }, ...pie(negocio), action: { buttons: botones } },
    texto: `${cuerpo.replace(/\*/g, "")}\n[${botones.map((b) => b.reply.title).join("] [")}]`,
  };
}

/** Elegir cuándo cierra el pedido: lo confirma y deja el link de su sala a mano. */
export function confirmacionVisita(cuando: Cuando, negocio: string, urlSala: string): MensajeInteractivo {
  const quien = negocio ? `al equipo de ${negocio}` : "al equipo";
  const cuerpo =
    cuando === "llamar"
      ? `Listo. Le paso tu número ${quien} y te llaman hoy.`
      : `Listo. Le paso tu pedido ${quien} y te escriben hoy para confirmar día y hora (${CUANDO[cuando].toLowerCase()}).`;
  return {
    interactive: {
      type: "cta_url",
      body: { text: cuerpo },
      ...pie(negocio),
      action: { name: "cta_url", parameters: { display_text: "Ver tu sala completa", url: urlSala } },
    },
    texto: `${cuerpo}\n${urlSala}`,
  };
}

/**
 * El alquiler que escribió el comprador. Entiende cómo se escribe en Bolivia
 * («2.500», «2.500,50», «1500 dólares», «$us 400») y avisa si lo dijo en otra
 * moneda que la de la casa. null = no es un monto (otra pregunta: la contesta
 * el agente).
 */
export function leerAlquiler(
  texto: string,
  monedaCasa: string
): { monto: number } | { otraMoneda: true } | null {
  const limpio = texto.trim().toLowerCase();
  if (limpio.length > 40) return null;
  const match = limpio.match(/\d[\d.,\s]*/);
  if (!match) return null;
  const resto = limpio.replace(match[0], " ");
  // Lo que no es número ni moneda ("tengo 3 hijos") no es una respuesta.
  if (/[a-zñáéíóú]{3,}/.test(resto.replace(/\b(bs|bolivianos?|us\$|\$us|usd|d[oó]lares?|al mes|mensual(es)?|por mes|pago|son|unos|como|más o menos|mas o menos)\b/g, ""))) {
    return null;
  }
  const crudo = match[0].replace(/\s/g, "");
  let valor: number;
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(crudo)) {
    valor = Number(crudo.replace(/\./g, "").replace(",", "."));
  } else if (/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(crudo)) {
    valor = Number(crudo.replace(/,/g, ""));
  } else {
    valor = Number(crudo.replace(",", "."));
  }
  if (!Number.isFinite(valor) || valor <= 0 || valor > 1_000_000) return null;
  const dijoBs = /\b(bs|bolivianos?)\b/.test(limpio);
  const dijoUsd = /(us\$|\$us|\busd\b|d[oó]lar)/.test(limpio);
  if ((monedaCasa === "USD" && dijoBs) || (monedaCasa === "BOB" && dijoUsd)) return { otraMoneda: true };
  return { monto: valor };
}

export function pedirEnMonedaDeLaCasa(casa: CasaWhatsapp, negocio: string): MensajeInteractivo {
  const cuerpo =
    casa.moneda === "USD"
      ? "Los precios están en dólares. ¿Cuánto es tu alquiler en dólares, más o menos?"
      : "Los precios están en bolivianos. ¿Cuánto es tu alquiler en bolivianos, más o menos?";
  const botones = [boton(idBoton({ accion: "sinalquiler", casaId: casa.id }), "No pago alquiler")];
  return {
    interactive: { type: "button", body: { text: cuerpo }, ...pie(negocio), action: { buttons: botones } },
    texto: `${cuerpo}\n[No pago alquiler]`,
  };
}

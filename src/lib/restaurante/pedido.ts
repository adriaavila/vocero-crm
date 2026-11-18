/**
 * Fork — vertical restaurante: las reglas PURAS de un pedido.
 *
 * Lo que este archivo garantiza, sin base de datos ni modelo de por medio:
 *
 * - El precio de cada línea sale del MENÚ, nunca de lo que escribió el
 *   modelo. El agente nombra productos y cantidades; el servidor los busca.
 * - Lo que no está en el menú, o está agotado, no entra al pedido: vuelve
 *   como rechazo para que el agente lo diga en vez de inventarlo.
 * - El estado solo avanza por las transiciones de `SIGUIENTE`; un pedido no
 *   vuelve de «entregado» a «en cocina».
 */

export const ESTADOS = [
  "por_confirmar",
  "en_cocina",
  "listo",
  "en_camino",
  "entregado",
  "cancelado",
] as const;
export type EstadoPedido = (typeof ESTADOS)[number];

export const MODALIDADES = ["envio", "retiro"] as const;
export type Modalidad = (typeof MODALIDADES)[number];

export const ESTADO_LABEL: Record<EstadoPedido, string> = {
  por_confirmar: "Por confirmar",
  en_cocina: "En cocina",
  listo: "Listo",
  en_camino: "En camino",
  entregado: "Entregado",
  cancelado: "Cancelado",
};

/** El estado del sistema que pinta cada estado del pedido (color = estado). */
export const ESTADO_TONO: Record<EstadoPedido, "atencion" | "atendiendo" | "activo" | "pausado"> = {
  por_confirmar: "atencion",
  en_cocina: "atendiendo",
  listo: "atendiendo",
  en_camino: "atendiendo",
  entregado: "activo",
  cancelado: "pausado",
};

export function isEstado(value: unknown): value is EstadoPedido {
  return typeof value === "string" && (ESTADOS as readonly string[]).includes(value);
}

export function isModalidad(value: unknown): value is Modalidad {
  return typeof value === "string" && (MODALIDADES as readonly string[]).includes(value);
}

/**
 * A dónde puede pasar un pedido desde cada estado. Un retiro salta «en
 * camino»: de listo a entregado. Cancelar se puede hasta antes de entregar.
 */
export function siguientes(estado: EstadoPedido, modalidad: Modalidad): EstadoPedido[] {
  switch (estado) {
    case "por_confirmar":
      return ["en_cocina", "cancelado"];
    case "en_cocina":
      return ["listo", "cancelado"];
    case "listo":
      return modalidad === "envio" ? ["en_camino", "cancelado"] : ["entregado", "cancelado"];
    case "en_camino":
      return ["entregado", "cancelado"];
    case "entregado":
    case "cancelado":
      return [];
  }
}

export function puedePasar(desde: EstadoPedido, hacia: EstadoPedido, modalidad: Modalidad): boolean {
  return siguientes(desde, modalidad).includes(hacia);
}

/** El paso «natural» (el botón principal de la tarjeta), o null si terminó. */
export function siguientePaso(estado: EstadoPedido, modalidad: Modalidad): EstadoPedido | null {
  return siguientes(estado, modalidad).find((e) => e !== "cancelado") ?? null;
}

/** Lo que dice el botón que lleva al siguiente estado. */
export const PASO_LABEL: Record<Exclude<EstadoPedido, "por_confirmar" | "cancelado">, string> = {
  en_cocina: "Confirmar y pasar a cocina",
  listo: "Marcar listo",
  en_camino: "Salió a entregar",
  entregado: "Entregado y cobrado",
};

/* ---------- Menú ---------- */

export type ExtraMenu = {
  id: string;
  name: string;
  /** Lo que suma al precio del producto; 0 = sin costo («sin cebolla»). */
  priceCents: number;
  active: boolean;
};

export type ProductoMenu = {
  id: string;
  name: string;
  priceCents: number;
  available: boolean;
  /** «Agotado por hoy»: no se ofrece hasta esta hora. */
  soldOutUntil: Date | string | null;
  extras: ExtraMenu[];
};

/** ¿Se puede ofrecer este producto ahora? */
export function disponible(p: Pick<ProductoMenu, "available" | "soldOutUntil">, now: Date): boolean {
  if (!p.available) return false;
  if (!p.soldOutUntil) return true;
  return new Date(p.soldOutUntil).getTime() <= now.getTime();
}

/**
 * El final del día de hoy en la zona del negocio: hasta ahí dura «agotado
 * por hoy». Con una zona que no existe, 24 horas.
 */
export function finDelDia(now: Date, timezone: string): Date {
  try {
    const partes = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(now);
    const n = (tipo: string) => Number(partes.find((p) => p.type === tipo)?.value ?? 0);
    const transcurrido = (n("hour") * 3600 + n("minute") * 60 + n("second")) * 1000;
    return new Date(now.getTime() - (now.getTime() % 1000) + (24 * 3600 * 1000 - transcurrido));
  } catch {
    return new Date(now.getTime() + 24 * 3600 * 1000);
  }
}

/* ---------- Del texto del modelo a líneas con precio ---------- */

/** Lo que el agente (o una persona) pide: nombres, no precios. */
export type LineaPedida = {
  name: string;
  quantity: number;
  extras?: string[];
  note?: string;
};

export type LineaResuelta = {
  menuItemId: string;
  name: string;
  quantity: number;
  unitPriceCents: number;
  extras: { name: string; priceCents: number }[];
  note: string | null;
  lineTotalCents: number;
};

export type Rechazo = {
  name: string;
  motivo: "no_esta" | "agotado" | "extra_no_esta";
  /** El extra que no existe, cuando el motivo es `extra_no_esta`. */
  extra?: string;
};

export type Resolucion = {
  lineas: LineaResuelta[];
  rechazos: Rechazo[];
  subtotalCents: number;
};

/** «Doble Queso », «doble queso» y «DOBLE QUESO» son el mismo producto. */
export function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Busca un nombre en una lista: exacto (normalizado) primero; después, si
 * UNO solo lo contiene o está contenido en él. Dos candidatos = ambiguo = no
 * se elige ninguno: mejor preguntar que cobrar otra cosa.
 */
export function buscarPorNombre<T extends { name: string }>(lista: T[], nombre: string): T | null {
  const buscado = normalizar(nombre);
  if (!buscado) return null;
  const exacto = lista.find((x) => normalizar(x.name) === buscado);
  if (exacto) return exacto;
  if (buscado.length < 3) return null;
  const parciales = lista.filter((x) => {
    const n = normalizar(x.name);
    return n.includes(buscado) || buscado.includes(n);
  });
  return parciales.length === 1 ? parciales[0]! : null;
}

export const CANTIDAD_MAX = 50;

/**
 * Convierte lo pedido en líneas con el precio del menú. Una línea con algo
 * que no existe o está agotado NO entra: vuelve en `rechazos`.
 */
export function resolverPedido(
  menu: ProductoMenu[],
  pedidas: LineaPedida[],
  now: Date
): Resolucion {
  const lineas: LineaResuelta[] = [];
  const rechazos: Rechazo[] = [];
  for (const pedida of pedidas) {
    const producto = buscarPorNombre(menu, pedida.name);
    if (!producto) {
      rechazos.push({ name: pedida.name, motivo: "no_esta" });
      continue;
    }
    if (!disponible(producto, now)) {
      rechazos.push({ name: producto.name, motivo: "agotado" });
      continue;
    }
    const activos = producto.extras.filter((e) => e.active);
    const extras: LineaResuelta["extras"] = [];
    let extraFaltante: string | null = null;
    for (const pedido of pedida.extras ?? []) {
      const extra = buscarPorNombre(activos, pedido);
      if (!extra) {
        extraFaltante = pedido;
        break;
      }
      if (!extras.some((e) => e.name === extra.name)) {
        extras.push({ name: extra.name, priceCents: extra.priceCents });
      }
    }
    if (extraFaltante) {
      rechazos.push({ name: producto.name, motivo: "extra_no_esta", extra: extraFaltante });
      continue;
    }
    const quantity = Math.min(CANTIDAD_MAX, Math.max(1, Math.round(pedida.quantity || 1)));
    const unit = producto.priceCents + extras.reduce((s, e) => s + e.priceCents, 0);
    lineas.push({
      menuItemId: producto.id,
      name: producto.name,
      quantity,
      unitPriceCents: producto.priceCents,
      extras,
      note: pedida.note?.trim() ? pedida.note.trim().slice(0, 200) : null,
      lineTotalCents: unit * quantity,
    });
  }
  return {
    lineas,
    rechazos,
    subtotalCents: lineas.reduce((s, l) => s + l.lineTotalCents, 0),
  };
}

/* ---------- Texto ---------- */

const SIMBOLO: Record<string, string> = { USD: "$", MXN: "$", BOB: "Bs", COP: "$", EUR: "€" };

/** «Bs 42», «$ 12,50»: decimales solo cuando hacen falta. */
export function precio(cents: number, currency: string): string {
  const simbolo = SIMBOLO[currency] ?? currency;
  const entero = cents % 100 === 0;
  const numero = new Intl.NumberFormat("es-MX", {
    minimumFractionDigits: entero ? 0 : 2,
    maximumFractionDigits: entero ? 0 : 2,
  }).format(cents / 100);
  return `${simbolo} ${numero}`;
}

/** «2 Doble queso (sin cebolla)». */
export function lineaTexto(l: Pick<LineaResuelta, "quantity" | "name" | "extras" | "note">): string {
  const detalle = [...l.extras.map((e) => e.name.toLowerCase()), ...(l.note ? [l.note] : [])];
  return `${l.quantity} ${l.name}${detalle.length ? ` (${detalle.join(", ")})` : ""}`;
}

/**
 * Lo que el CLIENTE lee cuando el agente arma su pedido. Lo escribe el
 * servidor con los precios reales (como los horarios de la agenda): el
 * modelo no redacta montos. Y no dice «confirmado»: eso lo dice una persona.
 */
export function resumenParaCliente(input: {
  intro?: string | null;
  lineas: LineaResuelta[];
  subtotalCents: number;
  currency: string;
  modalidad: Modalidad | null;
}): string {
  const cierre =
    input.modalidad === "envio"
      ? "Una persona del local te confirma en un momento el envío, el total y el tiempo."
      : "Una persona del local te lo confirma en un momento, con el tiempo.";
  return [
    input.intro?.trim() || "Te lo dejé armado:",
    ...input.lineas.map((l) => `${lineaTexto(l)} · ${precio(l.lineTotalCents, input.currency)}`),
    `Subtotal ${precio(input.subtotalCents, input.currency)}.`,
    cierre,
  ].join("\n");
}

/** Lo que el cliente lee cuando algo de lo que pidió no se puede. */
export function rechazoParaCliente(rechazos: Rechazo[]): string {
  const frases = rechazos.map((r) =>
    r.motivo === "agotado"
      ? `hoy no nos queda ${r.name}`
      : r.motivo === "extra_no_esta"
        ? `${r.name} no lo tenemos con «${r.extra}»`
        : `«${r.name}» no está en nuestro menú`
  );
  return `Te cuento: ${frases.join("; ")}. ¿Lo cambiamos por otra cosa del menú?`;
}

/** El mensaje que recibe el cliente en cada cambio de estado. */
export function avisoDeEstado(input: {
  estado: EstadoPedido;
  modalidad: Modalidad;
  totalCents: number;
  currency: string;
  number: number;
}): string | null {
  const total = precio(input.totalCents, input.currency);
  switch (input.estado) {
    case "en_cocina":
      return input.modalidad === "envio"
        ? `Confirmado tu pedido #${input.number}. Total ${total}, con el envío. Ya está en cocina.`
        : `Confirmado tu pedido #${input.number}. Total ${total}. Ya está en cocina; te avisamos cuando esté listo para retirar.`;
    case "listo":
      return input.modalidad === "retiro" ? `Tu pedido #${input.number} está listo para retirar.` : null;
    case "en_camino":
      return `Tu pedido #${input.number} ya salió. Total ${total}.`;
    case "cancelado":
      return `No pudimos tomar tu pedido #${input.number}. Disculpa la molestia; si quieres, lo armamos de nuevo.`;
    default:
      return null;
  }
}

/**
 * ¿Este texto es un aviso de estado de los de arriba? Sale por el mismo
 * camino que un mensaje de una persona, pero no lo redactó nadie: la bandeja
 * no debe ofrecer «Enséñaselo a tu agente» debajo.
 */
export function esAvisoDePedido(texto: string): boolean {
  return /^(Confirmado tu pedido|Tu pedido|No pudimos tomar tu pedido) #\d+/.test(texto.trim());
}

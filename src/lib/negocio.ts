/**
 * «Tu negocio»: lo que el dueño escribe con sus palabras (qué vende, precios,
 * zona) y cómo se guarda con lo que ya existe, sin esquema nuevo.
 *
 * Cada dato es UN bloque de la base de conocimiento (`kb_entry`, kind `block`)
 * que empieza con su rótulo («Precios y cómo cotizamos:»). El rótulo es lo que
 * deja volver a encontrarlo para editarlo en vez de duplicarlo, y de paso le
 * dice al modelo de qué trata el dato. Las preguntas frecuentes son entradas
 * `qa` normales, y la regla de pasar con una persona es el campo
 * `escalationRules` del perfil.
 *
 * Solo entra lo que el dueño escribió: aquí no hay generación ni relleno, y un
 * campo vacío no guarda nada. Puro y sin servidor, para usarlo en la pantalla
 * y en las pruebas.
 */

export type NegocioKey = "oferta" | "precios" | "zona";

/**
 * Con qué nace la regla «cuándo pasar con una persona»: escrita como la diría
 * el dueño, y tratada como SUGERENCIA mientras no la cambie.
 */
export const SUGGESTED_HANDOFF =
  "Cuando pidan hablar con una persona, tengan un reclamo o pregunten algo que no está aquí.";

/** Los textos con los que nacieron los negocios anteriores (en voz del agente y con jerga): también son sugerencia. */
const PREVIOUS_SUGGESTED_HANDOFFS = [
  "Pasa la conversación a un humano si el cliente lo solicita, si pide una excepción o decisión que no esté documentada, si hay una queja sensible o si la información necesaria no está en la knowledge base.",
  "Pasa la conversación a un humano si el cliente lo solicita, si pide una excepción o decisión que no esté documentada, si hay una queja sensible o si la información necesaria no está en lo que sabes del negocio.",
];

const squash = (text: string) => text.replace(/\s+/g, " ").trim();

/** ¿Sigue siendo el texto sugerido, sin que el dueño lo haya hecho suyo? */
export function isSuggestedHandoff(text: string | null | undefined): boolean {
  if (!text) return false;
  const normalized = squash(text);
  return [SUGGESTED_HANDOFF, ...PREVIOUS_SUGGESTED_HANDOFFS].some((known) => squash(known) === normalized);
}

export type NegocioField = {
  key: NegocioKey;
  /** Lo que ve el dueño. */
  label: string;
  /** Cómo queda escrito el rótulo del bloque, en voz del negocio. */
  kbLabel: string;
  placeholder: string;
  hint: string;
  rows: number;
};

export const NEGOCIO_MAX_CHARS = 1500;

export const NEGOCIO_FIELDS: NegocioField[] = [
  {
    key: "oferta",
    label: "Qué vendes o haces",
    kbLabel: "Qué hacemos o vendemos",
    placeholder: "Ej. Panadería artesanal: pan de masa madre, pasteles por encargo y café.",
    hint: "Cuéntalo como se lo dirías a un cliente nuevo.",
    rows: 3,
  },
  {
    key: "precios",
    label: "Precios o cómo cotizas",
    kbLabel: "Precios y cómo cotizamos",
    placeholder: "Ej. El pan va desde $2. Los pasteles se cotizan por porciones: pregunta cuántas personas son.",
    hint: "Si no tienes precios fijos, explica cómo calculas uno.",
    rows: 3,
  },
  {
    key: "zona",
    label: "Zona o dirección",
    kbLabel: "Zona o dirección",
    placeholder: "Ej. Av. Principal 123, Chacao. Entregamos en el este de Caracas.",
    hint: "Si vendes solo en línea, dilo y cuenta a dónde envías.",
    rows: 2,
  },
];

type Entry = {
  id: string;
  kind: "qa" | "block";
  question: string | null;
  answer: string | null;
  content: string | null;
};

export function negocioBlockContent(key: NegocioKey, text: string): string {
  const field = NEGOCIO_FIELDS.find((f) => f.key === key)!;
  return `${field.kbLabel}:\n${text.trim()}`;
}

/** El dato de «Tu negocio» que guarda este bloque, o null si es otro tipo de entrada. */
export function parseNegocioBlock(content: string | null | undefined): { key: NegocioKey; text: string } | null {
  if (!content) return null;
  for (const field of NEGOCIO_FIELDS) {
    const prefix = `${field.kbLabel}:`;
    if (content.startsWith(prefix)) return { key: field.key, text: content.slice(prefix.length).trim() };
  }
  return null;
}

export type NegocioCurrent = Record<NegocioKey, { id: string; text: string } | null>;
export type NegocioDraft = Record<NegocioKey, string>;

/** Lo que ya hay guardado de cada dato (el primero, si por alguna razón hubiera dos). */
export function negocioFromEntries(entries: Entry[]): NegocioCurrent {
  const current: NegocioCurrent = { oferta: null, precios: null, zona: null };
  for (const entry of entries) {
    if (entry.kind !== "block") continue;
    const parsed = parseNegocioBlock(entry.content);
    if (parsed && !current[parsed.key]) current[parsed.key] = { id: entry.id, text: parsed.text };
  }
  return current;
}

export type NegocioOp =
  | { type: "create"; key: NegocioKey; content: string }
  | { type: "update"; key: NegocioKey; id: string; content: string }
  | { type: "delete"; key: NegocioKey; id: string };

/**
 * Qué hay que escribir para pasar de lo guardado a lo que el dueño tiene en
 * pantalla: solo lo que cambió. Un campo que no se tocó no se manda (no mueve
 * la fecha del conocimiento, que es lo que vuelve vieja la prueba); uno que
 * se vació se borra, porque el dueño quitó ese dato.
 */
export function planNegocioSave(current: NegocioCurrent, draft: NegocioDraft): NegocioOp[] {
  const ops: NegocioOp[] = [];
  for (const field of NEGOCIO_FIELDS) {
    const text = draft[field.key].trim();
    const saved = current[field.key];
    if (!text) {
      if (saved) ops.push({ type: "delete", key: field.key, id: saved.id });
    } else if (!saved) {
      ops.push({ type: "create", key: field.key, content: negocioBlockContent(field.key, text) });
    } else if (saved.text !== text) {
      ops.push({ type: "update", key: field.key, id: saved.id, content: negocioBlockContent(field.key, text) });
    }
  }
  return ops;
}

/** `network`: ni siquiera hubo respuesta del servidor (se cayó la conexión), a diferencia de un rechazo con motivo. */
export type SaveResult = { ok: true } | { ok: false; message: string; network?: boolean };

const GENERIC_SAVE_ERROR = "No se pudo guardar. Revisa el texto y vuelve a intentarlo.";

/**
 * Lee el resultado de un guardado de la API: ok, o el motivo en palabras. Un
 * fallo de red también es un fallo (antes se ignoraba y el campo se vaciaba).
 */
export async function saveResult(request: () => Promise<Response>): Promise<SaveResult> {
  const response = await request().catch(() => null);
  if (response?.ok) return { ok: true };
  if (!response) return { ok: false, message: GENERIC_SAVE_ERROR, network: true };
  const payload = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
  return { ok: false, message: payload?.error?.message ?? GENERIC_SAVE_ERROR };
}

export function postKbEntry(body: Record<string, string>, fetchImpl: typeof fetch = fetch): Promise<SaveResult> {
  return saveResult(() =>
    fetchImpl("/api/kb", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

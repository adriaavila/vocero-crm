/**
 * Capa de agencia (fork) — «Cómo decidió el agente»: las frases de cada turno.
 * Puro y sin servidor, para probarlo sin dibujar nada y usarlo en la interfaz.
 * Las acciones son las que registra `agent_decision`: las de Rei (`reply`,
 * `none`, `handoff`, `move_stage`, `update_lead`, `offer_slots`, `book_slot`…)
 * y las de Nea (`replied`, `silent`, `noop`, `reset`).
 */

export const DECISION_FILTERS = ["todas", "sin-revisar", "fallos"] as const;
export type DecisionFilter = (typeof DECISION_FILTERS)[number];

export const FILTER_LABEL: Record<DecisionFilter, string> = {
  todas: "Todas",
  "sin-revisar": "Sin revisar",
  fallos: "Fallos",
};

export function parseFilter(raw: string | string[] | undefined | null): DecisionFilter {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return (DECISION_FILTERS as readonly string[]).includes(value ?? "") ? (value as DecisionFilter) : "todas";
}

/** El filtro de la URL en el parámetro `verdict` de la API (`none` = sin calificar). */
export function filterToVerdict(filter: DecisionFilter): "none" | "fallo" | undefined {
  return filter === "sin-revisar" ? "none" : filter === "fallos" ? "fallo" : undefined;
}

const ACTION_LABEL: Record<string, string> = {
  reply: "Respondió",
  replied: "Respondió",
  none: "No respondió",
  silent: "No respondió",
  noop: "No hizo nada",
  reset: "Reinició la memoria",
  handoff: "Pasó a una persona",
  move_stage: "Movió de etapa",
  update_lead: "Actualizó el lead",
  offer_slots: "Ofreció horarios",
  book_slot: "Agendó una cita",
  reschedule: "Reagendó la cita",
  cancel_booking: "Canceló la cita",
  follow_up: "Le escribió para retomar",
  follow_up_skip: "No retomó: la conversación había terminado",
};

function humanize(code: string): string {
  const text = code.replace(/[_-]+/g, " ").trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "Acción";
}

export function actionLabel(action: string): string {
  return ACTION_LABEL[action] ?? humanize(action);
}

/** Por qué pasó a una persona, en palabras llanas. */
export const HANDOFF_PLAIN: Record<string, string> = {
  cliente: "Pidió hablar con alguien.",
  modelo: "El agente no supo cómo seguir.",
  error: "La respuesta automática falló.",
  ventana: "La ventana de 24 h se cerró antes de contestar.",
  hostilidad: "Conversación delicada: el agente se retiró.",
  manual_reply: "Respondiste desde el teléfono.",
};

export function handoffPlain(reason: string | null): string | null {
  return reason ? (HANDOFF_PLAIN[reason] ?? humanize(reason) + ".") : null;
}

const lcFirst = (s: string) => (s.length > 1 && s[1] === s[1]!.toLowerCase() ? s.charAt(0).toLowerCase() + s.slice(1) : s);

/**
 * El recorrido del turno en una línea: «Respondió · actualizó lead: nombre ·
 * ofreció 2 horarios». Un paso que repite la acción sin decir más (lo que deja
 * Rei) no se vuelve a escribir; uno que falló lo dice.
 */
export function decisionTrail(d: {
  action: string;
  steps: { tool: string; summary: string; ok: boolean }[];
}): string {
  const head = actionLabel(d.action);
  const parts = d.steps.flatMap((step) => {
    const summary = step.summary.trim();
    if (!summary && step.tool === d.action) return step.ok ? [] : ["falló"];
    const text = summary ? lcFirst(summary) : lcFirst(actionLabel(step.tool));
    return [step.ok ? text : `${text} (falló)`];
  });
  return [head, ...parts].join(" · ");
}

export function formatLatency(ms: number | null): string | null {
  if (ms === null) return null;
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1).replace(".", ",")} s`;
}

/** Las partes de la línea en mono pequeño: modelo, versión del prompt y tiempo. */
export function decisionMeta(d: { model: string | null; promptVersion: string | null; latencyMs: number | null }): string[] {
  return [d.model, d.promptVersion ? `prompt ${d.promptVersion}` : null, formatLatency(d.latencyMs)].filter((x): x is string => Boolean(x));
}

/** «hoy 14:05», «ayer 21:30» o «2 oct 08:10», siempre en la zona del negocio. */
export function whenLabel(iso: string, timezone: string, now: Date = new Date()): string {
  const date = new Date(iso);
  const day = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(d);
  const time = new Intl.DateTimeFormat("es", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: timezone }).format(date);
  if (day(date) === day(now)) return `hoy ${time}`;
  if (day(date) === day(new Date(now.getTime() - 86_400_000))) return `ayer ${time}`;
  const dm = new Intl.DateTimeFormat("es", { day: "numeric", month: "short", timeZone: timezone }).format(date).replace(".", "");
  return `${dm} ${time}`;
}

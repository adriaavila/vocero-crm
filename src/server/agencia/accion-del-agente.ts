import type { AgentActionType } from "@/server/ai/actions";

/**
 * Fork — lo que el modelo decidió, revisado contra lo que el cliente vería y
 * contra lo que el dueño escribió. PURA: sin BD ni reloj.
 *
 * Salió de la corrida del Laboratorio de SAMER en Rei (25-10, nota 50):
 *
 * 1. El modelo escribía la herramienta DENTRO del texto: el cliente recibía
 *    `{"tool_name": "handoff", …}` o «*(Handover in progress)*», y el traspaso
 *    no ocurría. Aquí se quita del texto y, si era un traspaso, se hace.
 * 2. Las reglas de SAMER dicen «si pide visita, pásalo a Marcelo» y el modelo
 *    seguía calificando tres turnos, o ofrecía horarios de una agenda que
 *    SAMER nunca configuró. Si el dueño escribió que las visitas las lleva una
 *    persona y el cliente pide una, el turno es un traspaso.
 */

/** Las claves con que el modelo nombra una herramienta cuando la escribe a mano. */
const TOOL_KEY = /"(tool_name|tool|function|action)"\s*:/;

/** «*(Handover in progress)*», «(traspaso a humano)»… acotaciones, no texto para el cliente. */
const ACOTACION =
  /\*{0,2}_?\(\s*(?:handover|handoff|hand-off|traspaso|escalando|derivando|transfer)[^)]*\)_?\*{0,2}\.?/gi;

/** Herramientas que, escritas en el texto, querían decir «pásalo a una persona». */
const TOOLS_DE_TRASPASO = /\b(handoff|hand_off|escalar|escalate|transfer|derivar)\b/i;

type Limpio = { text: string; traspaso: boolean };

/** Fin del objeto JSON que abre en `start`, contando llaves; -1 si no cierra. */
function cierreDe(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Quita del texto las herramientas escritas a mano y las acotaciones. */
export function limpiarTexto(text: string): Limpio {
  let out = text;
  let traspaso = false;

  // Bloques ```json … ``` que nombran una herramienta.
  out = out.replace(/```(?:json)?\s*([\s\S]*?)```/gi, (block, inner: string) => {
    if (!TOOL_KEY.test(inner)) return block;
    if (TOOLS_DE_TRASPASO.test(inner)) traspaso = true;
    return "";
  });

  // Objetos sueltos `{ "tool_name": … }`, con llaves anidadas.
  for (;;) {
    const m = TOOL_KEY.exec(out);
    if (!m) break;
    const start = out.lastIndexOf("{", m.index);
    const end = start === -1 ? -1 : cierreDe(out, start);
    if (start === -1 || end === -1) break;
    const json = out.slice(start, end + 1);
    if (TOOLS_DE_TRASPASO.test(json)) traspaso = true;
    out = out.slice(0, start) + out.slice(end + 1);
  }

  out = out.replace(ACOTACION, () => {
    traspaso = true;
    return "";
  });

  out = out
    .split("\n")
    .map((l) => l.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { text: out, traspaso };
}

/**
 * ¿Las reglas de escalado del dueño mandan las visitas a una persona? Una
 * línea que habla de visitas en las reglas de ESCALADO lo dice, salvo que la
 * niegue («no pases las visitas», «las visitas agéndalas tú»).
 */
export function reglasPasanVisitas(escalationRules: string | null | undefined): boolean {
  if (!escalationRules) return false;
  return escalationRules
    .split("\n")
    .some(
      (l) =>
        /\bvisit/i.test(l) &&
        !/mensaje al pasar/i.test(l) &&
        !/\b(no|nunca|jam[aá]s)\b/i.test(l) &&
        !/ag[eé]nd[a-z]*\s+t[uú]\b/i.test(l)
    );
}

/** El cliente pide ver la propiedad. */
export function pideVisita(text: string): boolean {
  const t = text.toLowerCase();
  return (
    /\bvisit/.test(t) ||
    /\b(ir|pasar|pasarme|ir a) a ver\b/.test(t) ||
    /\b(la|lo) (puedo|podr[ií]a|podemos) (ir a )?ver\b/.test(t) ||
    /\b(puedo|podr[ií]a|quiero|quisiera|me gustar[ií]a) (ir a )?(verla|verlo|conocerla|conocerlo)\b/.test(t) ||
    /\bpara ver(la|lo)?\s+(la|el)?\s*(casa|vivienda|depa|departamento|propiedad|local|modelo)\b/.test(t) ||
    /\bcasa modelo\b/.test(t)
  );
}

/** El «Mensaje al pasar: "…"» que el dueño dejó en sus reglas, si lo dejó. */
export function mensajeAlPasar(escalationRules: string | null | undefined): string | null {
  if (!escalationRules) return null;
  const m = /mensaje al pasar\s*:?\s*["“«]([^"”»]+)["”»]/i.exec(escalationRules);
  return m?.[1]?.trim() || null;
}

const DESPEDIDA_VISITA =
  "Te paso con una persona del equipo que te va a coordinar la visita. Te escribe por aquí 🙂";

export type Ajuste = "herramienta_en_texto" | "traspaso_prometido" | "visita_a_persona";

/**
 * El texto le dice al cliente que ya lo pasó a una persona. Solo en presente
 * o pasado: «si quieres, te paso con Marcelo» es una oferta, no un traspaso.
 */
export function prometeTraspaso(text: string): boolean {
  const t = text.toLowerCase();
  if (/\b(si quieres|si prefieres|quieres que|te gustar[ií]a que|puedo pasarte)\b/.test(t)) return false;
  return (
    /\b(te paso con|te paso a|te comunico con|ya le avis[eé]|ya avis[eé]|ya le pas[eé]|te derivo)\b/.test(t) ||
    /\b(estamos|estoy) coordinando el paso\b/.test(t) ||
    // «Marcelo te escribe mañana tempranito» (Rei, 27-10) sin pasarlo.
    /\b(te escribe|te va a escribir|te contacta|te va a contactar|te contactar[aá]|te llama|te va a llamar)\b/.test(t)
  );
}

/** El texto que el cliente recibiría con esta acción. */
export function textoDe(action: AgentActionType): string | undefined {
  switch (action.action) {
    case "reply":
      return action.text;
    case "handoff":
      return action.farewell;
    case "none":
      return undefined;
    default:
      return action.reply;
  }
}

function conTexto(action: AgentActionType, text: string): AgentActionType {
  const t = text || undefined;
  switch (action.action) {
    case "reply":
      return t ? { ...action, text: t } : { action: "none" };
    case "handoff":
      return { ...action, farewell: t };
    case "none":
      return action;
    default:
      return { ...action, reply: t };
  }
}

export function corregirAccion(input: {
  action: AgentActionType;
  ultimaDelCliente: string;
  escalationRules: string | null | undefined;
}): {
  action: AgentActionType;
  ajustes: Ajuste[];
  /** La nota de un update_lead que se volvió traspaso: se guarda igual. */
  nota?: string;
} {
  let action = input.action;
  const ajustes: Ajuste[] = [];
  let nota: string | undefined;

  const original = textoDe(action);
  if (original !== undefined) {
    const limpio = limpiarTexto(original);
    if (limpio.text !== original.trim() || limpio.traspaso) {
      ajustes.push("herramienta_en_texto");
      action =
        limpio.traspaso && action.action !== "handoff"
          ? {
              action: "handoff",
              reason: "herramienta en el texto",
              farewell: limpio.text || mensajeAlPasar(input.escalationRules) || undefined,
            }
          : conTexto(action, limpio.text);
    }
  }

  // Dijo «te paso con Marcelo» pero no lo pasó: el cliente espera a alguien
  // que nunca se entera. Lo que prometió, se hace. Vale para cualquier acción
  // con texto: en Rei (27-10) lo prometía dentro de un update_lead.
  const prometido = action.action === "handoff" ? undefined : textoDe(action);
  if (prometido && prometeTraspaso(prometido)) {
    ajustes.push("traspaso_prometido");
    if (action.action === "update_lead") nota = action.note;
    action = { action: "handoff", reason: "prometió pasarlo", farewell: prometido };
  }

  if (
    action.action !== "handoff" &&
    reglasPasanVisitas(input.escalationRules) &&
    pideVisita(input.ultimaDelCliente)
  ) {
    ajustes.push("visita_a_persona");
    action = {
      action: "handoff",
      reason: "pidió visita",
      farewell: mensajeAlPasar(input.escalationRules) ?? DESPEDIDA_VISITA,
    };
  }

  return { action, ajustes, ...(nota ? { nota } : {}) };
}

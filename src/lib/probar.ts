/**
 * «Probar»: el resultado de la simulación del Laboratorio en palabras del
 * dueño. La simulación no cambia; lo que cambia es que un 62 de 100 sin más no le
 * dice qué hacer. Aquí cada hallazgo del juez se vuelve «qué pasó» y «dónde se
 * arregla». Puro y sin servidor.
 */

/** Desde aquí un puntaje «se ve bien». Es un consejo: nunca bloquea activar. */
export const GOOD_SCORE = 80;

export type Hallazgo = {
  tipo: "alucinacion" | "fuera_de_kb" | "debio_escalar" | "tono";
  evidencia: string;
  sugerencia?: { pregunta: string; respuesta: string };
};

export type CaseLite = {
  id: string;
  personaLabel: string;
  status: string;
  veredicto: "verde" | "amarillo" | "rojo" | null;
  hallazgos: Hallazgo[];
};

export type RunLite = { status: "running" | "done" | "failed"; score: number | null };

/**
 * ¿El resultado se ve bien? 80 o más y ningún caso en rojo. Solo colorea y
 * aconseja: activar lo decide el dueño, basta con haber probado (ver
 * `server/readiness.ts`).
 */
export function looksGood(score: number | null, redCount: number): boolean {
  return score !== null && score >= GOOD_SCORE && redCount === 0;
}

/**
 * Lo que encontró la prueba, en una frase: «La prueba encontró 2 respuestas
 * graves (67 de 100).» null si se ve bien o no hay resultado. Probar la usa tal
 * cual y Activar le suma lo que se puede hacer (`consejoDeResultado`).
 */
export function resumenDeResultado(score: number | null, redCount: number): string | null {
  if (score === null || looksGood(score, redCount)) return null;
  return redCount === 0
    ? `La prueba sacó ${score} de 100.`
    : `La prueba encontró ${redCount} ${redCount === 1 ? "respuesta grave" : "respuestas graves"} (${score} de 100).`;
}

/**
 * La línea honesta junto al botón de activar cuando el resultado no se ve
 * bien. null si se ve bien o no hay resultado. Nunca bloquea: el dueño decide.
 */
export function consejoDeResultado(score: number | null, redCount: number): string | null {
  const resumen = resumenDeResultado(score, redCount);
  if (!resumen) return null;
  const arreglar = redCount === 1 ? "corregirla" : redCount === 0 ? "mejorar las respuestas" : "corregirlas";
  return `${resumen} Puedes activarlo igual o ${arreglar} primero.`;
}

export type Fix = {
  /** Qué pasó. */
  what: string;
  /** Dónde se arregla. */
  to: { href: string; label: string };
  /** Si el juez propuso una respuesta, se puede agregar aquí mismo. */
  suggestion?: { pregunta: string; respuesta: string };
};

const FIX: Record<Hallazgo["tipo"], Omit<Fix, "suggestion">> = {
  alucinacion: {
    what: "Dijo algo que no está en tu información.",
    to: { href: "/agent#negocio", label: "Revisar Tu negocio" },
  },
  fuera_de_kb: {
    what: "No encontró en tu información cómo responder esto.",
    to: { href: "/agent#negocio", label: "Agregar el dato en Tu negocio" },
  },
  debio_escalar: {
    what: "Debió pasarte la conversación y siguió respondiendo.",
    to: { href: "/agent#negocio", label: "Revisar cuándo pasar con una persona" },
  },
  tono: {
    what: "Su forma de hablar no fue la que querías.",
    to: { href: "/agent#avanzado", label: "Ajustar el tono" },
  },
};

export function fixFor(hallazgo: Hallazgo): Fix {
  return { ...FIX[hallazgo.tipo], suggestion: hallazgo.sugerencia };
}

export type CaseToFix = { id: string; label: string; red: boolean; hallazgos: { index: number; evidencia: string; fix: Fix }[] };

/** Los casos que hay que mirar, primero los graves. Los verdes no se listan. */
export function casesToFix(cases: CaseLite[]): CaseToFix[] {
  return cases
    .filter((c) => c.veredicto === "rojo" || c.veredicto === "amarillo")
    .sort((a, b) => Number(b.veredicto === "rojo") - Number(a.veredicto === "rojo"))
    .map((c) => ({
      id: c.id,
      label: c.personaLabel,
      red: c.veredicto === "rojo",
      hallazgos: c.hallazgos.map((h, index) => ({ index, evidencia: h.evidencia, fix: fixFor(h) })),
    }));
}

export type ProbarKind = "sin_prueba" | "en_curso" | "no_termino" | "paso" | "vieja" | "revisar";

/**
 * En qué punto está la prueba.
 * `current` es lo que dice la puesta en marcha: null si todavía no se sabe, y
 * entonces no se afirma que esté vieja.
 */
export function probarKind(input: {
  latest: RunLite | null;
  cases: CaseLite[];
  /**
   * Los casos graves de la última corrida, tal como los cuenta la lista de
   * corridas. Si viene, manda sobre `cases`: el detalle de los casos llega en
   * una segunda lectura, y hasta entonces «no hay casos» no es «no hubo graves».
   */
  redCount?: number;
  current: boolean | null;
}): ProbarKind {
  const { latest, cases, current } = input;
  if (!latest) return "sin_prueba";
  if (latest.status === "running") return "en_curso";
  if (latest.status === "failed" || latest.score === null) return "no_termino";
  const reds = input.redCount ?? cases.filter((c) => c.veredicto === "rojo").length;
  // Vieja manda: lo que importa es haber probado después del último cambio.
  if (current === false) return "vieja";
  return looksGood(latest.score, reds) ? "paso" : "revisar";
}

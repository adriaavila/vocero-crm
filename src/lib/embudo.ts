/**
 * Capa de agencia (fork) — el embudo de ventas a partir del tablero, como el
 * de rei-crm: cada fila cuenta los leads que llegaron AL MENOS a esa etapa, con
 * el porcentaje que pasó desde la anterior, y abajo el cierre y los perdidos.
 *
 * ponytail: sin historial de etapas, «llegó al menos a» se lee de dónde está
 * cada lead hoy (el tablero avanza en orden). Un perdido cuenta solo en la
 * primera fila: se sabe que entró, no hasta dónde llegó. Con historial, contar
 * la etapa más alta alcanzada, como hace rei-crm.
 */

export type StageCount = { id: string; name: string; kind: "open" | "won" | "lost"; count: number };

export type FunnelStep = {
  id: string;
  name: string;
  won: boolean;
  reached: number;
  /** Parte del total, 0–1: el ancho de la fila. */
  share: number;
  /** % que pasó desde la fila anterior; null en la primera o si no llegó nadie. */
  fromPrev: number | null;
};

export type Funnel = { steps: FunnelStep[]; total: number; won: number; lost: number; close: number | null };

/** `stages` en el orden del tablero. */
export function funnel(stages: StageCount[]): Funnel {
  const rows = stages.filter((s) => s.kind !== "lost");
  const lost = stages.reduce((n, s) => (s.kind === "lost" ? n + s.count : n), 0);
  const total = rows.reduce((n, s) => n + s.count, lost);
  const won = rows.reduce((n, s) => (s.kind === "won" ? n + s.count : n), 0);

  let after = total - lost;
  const reached = rows.map((s, i) => {
    const r = i === 0 ? total : after;
    after -= s.count;
    return r;
  });

  return {
    steps: rows.map((s, i) => {
      const prev = i > 0 ? reached[i - 1] ?? 0 : 0;
      const r = reached[i] ?? 0;
      return {
        id: s.id,
        name: s.name,
        won: s.kind === "won",
        reached: r,
        share: total > 0 ? r / total : 0,
        fromPrev: i > 0 && prev > 0 ? Math.round((r / prev) * 100) : null,
      };
    }),
    total,
    won,
    lost,
    close: total > 0 ? Math.round((won / total) * 100) : null,
  };
}

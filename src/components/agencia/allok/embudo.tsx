"use client";

import { Fragment } from "react";
import { funnel, type StageCount } from "@/lib/embudo";
import type { StageDto } from "@/lib/types";
import { cn } from "@/lib/utils";
import { StateDot } from "./mark";
import { useSystemState } from "./system-state";

const ROW = 46;

/**
 * El embudo de ventas dibujado (Inicio · Ventas), a partir del de rei-crm:
 * cada fila es una etapa y su ancho, cuántos llegaron hasta ahí; al lado, qué
 * parte pasó desde la anterior. Por el centro bajan puntos: los leads pasando
 * de una etapa a la siguiente (el trazo que fluye de allok.fun). Tinta para lo
 * que sigue abierto, el verde de estado para lo ganado.
 *
 * `ghost` (o un tablero vacío) dibuja solo la forma, sin una sola cifra.
 */
export function FunnelChart({ stages, ghost = false }: { stages: StageCount[]; ghost?: boolean }) {
  const f = funnel(stages);
  const steps = f.steps;
  if (steps.length === 0) return null;
  const empty = ghost || f.total === 0;
  const taper = (i: number) => 1 - (i * 0.6) / Math.max(steps.length - 1, 1);
  // Una etapa chica se sigue viendo: nunca menos del 7 % del ancho.
  const widths = steps.map((s, i) => (empty ? taper(i) : Math.max(s.share, 0.07)));
  const height = steps.length * ROW;

  return (
    <div>
      <div
        className="grid gap-x-4 px-5 pt-5"
        style={{ gridTemplateColumns: "minmax(0,7.5rem) minmax(0,1fr) 3.25rem", gridTemplateRows: `repeat(${steps.length}, ${ROW}px)` }}
      >
        <div aria-hidden className="relative col-start-2 row-span-full row-start-1" style={{ height }}>
          <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
            {steps.map((s, i) => {
              const top = (widths[i] ?? 0) * 50;
              const bottom = (widths[i + 1] ?? (widths[i] ?? 0) * 0.9) * 50;
              const y = i * ROW + 2;
              const h = ROW - 4;
              return (
                <polygon
                  key={s.id}
                  data-state={s.won && !empty ? "activo" : undefined}
                  points={`${50 - top},${y} ${50 + top},${y} ${50 + bottom},${y + h} ${50 - bottom},${y + h}`}
                  className="ak-grow-x"
                  style={{
                    "--i": i,
                    transformBox: "fill-box",
                    fill: empty ? "var(--ground-3)" : s.won ? "var(--st)" : "var(--text)",
                    opacity: empty || s.won ? 1 : Math.max(0.4, 1 - i * 0.16),
                  } as React.CSSProperties}
                />
              );
            })}
          </svg>
          {f.total > 0 && !ghost && (
            <svg className="ak-enter absolute inset-0 h-full w-full overflow-visible" style={{ "--i": steps.length } as React.CSSProperties}>
              <line x1="50%" x2="50%" y1="10" y2={height - 10} stroke="var(--bg)" strokeWidth="4" className="ak-flow ak-flow-entrada" />
            </svg>
          )}
          {empty && !ghost && (
            <svg className="absolute inset-0 h-full w-full overflow-visible">
              <line x1="50%" x2="50%" y1="10" y2={height - 10} stroke="var(--ground-4)" strokeWidth="4" strokeLinecap="round" strokeDasharray="0 12" />
            </svg>
          )}
        </div>

        {steps.map((s, i) => (
          <Fragment key={s.id}>
            <span className="col-start-1 flex min-w-0 items-center gap-2 text-[13.5px]" style={{ gridRowStart: i + 1 }}>
              {s.won && !empty && <StateDot state="activo" size={7} decorative />}
              <span className="truncate">{s.name}</span>
            </span>
            <span className="col-start-3 flex flex-col items-end justify-center" style={{ gridRowStart: i + 1 }}>
              {!empty && (
                <>
                  <span className="font-mono text-[14px] font-semibold tabular-nums">{s.reached}</span>
                  {s.fromPrev !== null && (
                    <span className="font-mono text-[10.5px] text-text-3" title="Pasó desde la etapa anterior">
                      {s.fromPrev}%
                    </span>
                  )}
                </>
              )}
            </span>
          </Fragment>
        ))}
      </div>

      {!ghost && (
        <p className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1 border-t px-5 py-3.5 text-[12.5px] text-text-2">
          {empty ? (
            "Cuando entren leads, los vas a ver bajar por aquí."
          ) : (
            <>
              <span>
                Cierre <span className="font-mono font-semibold text-foreground">{f.close}%</span>
              </span>
              <span className="flex items-center gap-1.5">
                <StateDot state="pausado" size={7} decorative />
                Perdidos <span className="font-mono font-semibold text-foreground">{f.lost}</span>
              </span>
              <span className="ml-auto font-mono text-[10.5px] uppercase tracking-[0.12em] text-text-3">
                Llegaron al menos a cada etapa
              </span>
            </>
          )}
        </p>
      )}
    </div>
  );
}

/**
 * El mismo embudo, acostado, arriba del tablero (/pipeline): de etapa a etapa
 * corren puntos, y encima de cada tramo, qué parte pasó. Solo en el SaaS: el
 * tablero de una instancia Vocero queda como estaba.
 */
export function FunnelStrip({ stages, leads }: { stages: StageDto[]; leads: { stageId: string }[] }) {
  const snapshot = useSystemState();
  if (!snapshot || stages.length === 0) return null;
  const f = funnel(
    [...stages]
      .sort((a, b) => a.position - b.position)
      .map((s) => ({ id: s.id, name: s.name, kind: s.kind, count: leads.filter((l) => l.stageId === s.id).length })),
  );
  if (f.total === 0) return null;

  return (
    <section aria-label="Embudo de ventas" className="relative flex snap-x items-stretch overflow-x-auto border-b px-4 py-3 sm:px-6">
      {/* El tablero cuenta dónde está cada lead hoy; el embudo, hasta dónde llegó. */}
      <div className="mr-5 flex w-[6.5rem] shrink-0 flex-col justify-center gap-1">
        <span className="kicker">Embudo</span>
        <span className="text-[11.5px] leading-snug text-text-3">Llegaron al menos a cada etapa</span>
      </div>
      {f.steps.map((s, i) => (
        <Fragment key={s.id}>
          {i > 0 && (
            <div className="flex w-16 shrink-0 flex-col items-stretch justify-center px-2">
              <span className="sr-only">{`${s.fromPrev ?? 0}% pasó a ${s.name}`}</span>
              <span aria-hidden className="text-center font-mono text-[10.5px] text-text-3">{s.fromPrev ?? 0}%</span>
              <svg aria-hidden className="mt-1 h-1 w-full overflow-visible" data-state={s.won ? "activo" : undefined}>
                <line x1="2" x2="100%" y1="2" y2="2" stroke={s.won ? "var(--st)" : "var(--text-3)"} strokeWidth="3" className="ak-flow ak-flow-entrada" />
              </svg>
            </div>
          )}
          <div className="ak-enter min-w-[6.5rem] shrink-0 snap-start rounded-md px-1 py-0.5" style={{ "--i": i } as React.CSSProperties}>
            <span className="flex items-center gap-1.5 text-[12.5px] text-text-2">
              {s.won && <StateDot state="activo" size={7} decorative />}
              <span className="truncate">{s.name}</span>
            </span>
            {/* «llegaron»: el tablero de abajo cuenta dónde están hoy, esto hasta dónde llegaron. */}
            <span className="mt-0.5 flex items-baseline gap-1.5">
              <span className="font-mono text-[19px] font-semibold leading-tight tabular-nums">{s.reached}</span>
              <span className="text-[11.5px] text-text-3">llegaron</span>
            </span>
            <span className="mt-1.5 block h-1 w-full overflow-hidden rounded-full bg-[var(--ground-3)]">
              <span
                data-state={s.won ? "activo" : undefined}
                className={cn("ak-grow-x block h-full rounded-full", s.won ? "bg-[var(--st)]" : "bg-foreground")}
                style={{ width: `${Math.max(s.share * 100, 4)}%`, transformOrigin: "0 50%", "--i": i } as React.CSSProperties}
              />
            </span>
          </div>
        </Fragment>
      ))}
      <div className="ml-auto flex shrink-0 flex-col justify-center gap-1 border-l pl-5 text-[12px] text-text-2">
        <span>
          Cierre <span className="font-mono font-semibold text-foreground">{f.close}%</span>
        </span>
        <span className="flex items-center gap-1.5">
          <StateDot state="pausado" size={7} decorative />
          Perdidos <span className="font-mono font-semibold text-foreground">{f.lost}</span>
        </span>
      </div>
    </section>
  );
}

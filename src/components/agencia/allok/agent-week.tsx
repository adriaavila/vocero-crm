"use client";

import { Fragment, useEffect, useState } from "react";
import { WEEKDAYS, type WeekdayKey } from "@/lib/time/slots";
import { coverage, inside, minuteInTz, weekdayInTz, type ResponseMode, type Week } from "@/lib/cobertura";
import { cn } from "@/lib/utils";

const SHORT: Record<WeekdayKey, string> = { mon: "L", tue: "M", wed: "X", thu: "J", fri: "V", sat: "S", sun: "D" };

type Who = "agente" | "equipo" | "nadie";

/**
 * Agente · «La semana de tu agente»: siete filas de 24 puntos, uno por hora.
 * Verde, contesta tu agente; tinta, tu equipo; hueco, nadie. Se redibuja
 * mientras editas, así el horario se entiende antes de guardarlo: lo que
 * cambia entra en ola. Mismas reglas que el servidor (`lib/cobertura`).
 */
export function AgentWeek({ hours, mode, timezone, pro }: { hours: Week; mode: ResponseMode; timezone: string; pro: boolean }) {
  const [now, setNow] = useState<{ day: WeekdayKey; hour: number } | null>(null);
  useEffect(() => {
    const tick = () => {
      // La zona se escribe a mano: mientras no exista, no hay «ahora».
      try {
        const date = new Date();
        setNow({ day: weekdayInTz(date, timezone), hour: Math.floor(minuteInTz(date, timezone) / 60) });
      } catch {
        setNow(null);
      }
    };
    tick();
    const timer = setInterval(tick, 60_000);
    return () => clearInterval(timer);
  }, [timezone]);

  const rows = WEEKDAYS.map((day) => {
    const { team, agent } = coverage(hours, mode, pro, day);
    // Cada punto mira la mitad de su hora: 9:00–18:00 son nueve puntos de equipo.
    const cells = Array.from({ length: 24 }, (_, h): Who =>
      inside(agent, h * 60 + 30) ? "agente" : inside(team, h * 60 + 30) ? "equipo" : "nadie",
    );
    return { day, cells };
  });
  const agentHours = rows.reduce((n, r) => n + r.cells.filter((c) => c === "agente").length, 0);
  const teamHours = rows.reduce((n, r) => n + r.cells.filter((c) => c === "equipo").length, 0);
  const summary =
    mode === "all_day"
      ? pro
        ? "Tu agente contesta las 168 horas de la semana."
        : "«Todo el día» es de Pro: con tu plan, tu agente no contesta."
      : agentHours === 0
        ? teamHours > 0
          ? "Tu equipo atiende las 168 horas: tu agente no contesta."
          : "Sin horario tu agente no contesta: marca los días de tu equipo."
        : `Tu agente contesta ${agentHours} de las 168 horas de la semana; tu equipo, ${teamHours}.`;

  return (
    <figure className="rounded-md border p-3 sm:p-4">
      <figcaption className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <span className="text-sm font-semibold">La semana de tu agente</span>
        <ul aria-hidden className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-text-3">
          <li className="flex items-center gap-1.5">
            <span data-state="activo" className="h-2 w-2 rounded-full bg-[var(--st)]" />
            Tu agente
          </li>
          <li className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-foreground" />
            Tu equipo
          </li>
          <li className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full border border-[var(--rule)]" />
            Nadie
          </li>
        </ul>
      </figcaption>

      <div
        role="img"
        aria-label={summary}
        className="mt-3 grid items-center gap-y-1.5"
        style={{ gridTemplateColumns: "1.1rem repeat(24, minmax(0, 1fr))" }}
      >
        {rows.map(({ day, cells }, r) => (
          <Fragment key={day}>
            <span className={cn("font-mono text-[10.5px] text-text-3", now?.day === day && "font-semibold text-foreground")}>
              {SHORT[day]}
            </span>
            {cells.map((who, h) => {
              const current = now?.day === day && now.hour === h;
              return (
                <span key={h} className="grid h-3 place-items-center">
                  <span
                    key={who}
                    data-state={who === "agente" ? "activo" : undefined}
                    className={cn(
                      "ak-pop block rounded-full",
                      who === "agente" && "h-2 w-2 bg-[var(--st)]",
                      who === "equipo" && "h-2 w-2 bg-foreground",
                      who === "nadie" && "h-1.5 w-1.5 border border-[var(--rule)]",
                    )}
                    style={{
                      "--i": r + h,
                      boxShadow: current ? "0 0 0 2px var(--bg), 0 0 0 3.5px var(--text)" : undefined,
                    } as React.CSSProperties}
                  />
                </span>
              );
            })}
          </Fragment>
        ))}
        <span />
        {Array.from({ length: 24 }, (_, h) => (
          <span key={h} className="pt-1 text-center font-mono text-[9.5px] text-text-3">
            {h % 6 === 0 ? String(h).padStart(2, "0") : ""}
          </span>
        ))}
      </div>

      <p className="mt-3 text-xs leading-5 text-text-2">{summary}</p>
    </figure>
  );
}

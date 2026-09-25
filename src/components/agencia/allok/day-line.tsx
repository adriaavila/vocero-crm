"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { SystemState } from "@/lib/estado";
import { hhmm, minuteInTz, type Span } from "@/lib/cobertura";
import type { Centro } from "@/server/agencia/estado";
import { cn } from "@/lib/utils";

type Day = Centro["day"];

const DAY = 1440;
const at = (minute: number) => `${(minute / DAY) * 100}%`;
/** Más de cinco puntos en una columna ya no caben: se cuentan. */
const MAX_STACK = 5;
const DOT = 9;
const PITCH = 11;
/** Altura de la base de los puntos, sobre la vía. */
const BASE = 40;

const NOTE: Record<SystemState, string> = {
  activo: "Respondida",
  atendiendo: "allok está respondiendo",
  atencion: "Espera por ti",
  pausado: "Quieta",
};

/** Qué dice la línea, en una frase, según quién está de turno ahora. */
function sentence(day: Day, now: number | null): string {
  if (!day.configured) return "Sin horario de respuesta, tu agente no contesta.";
  if (!day.agentOn) return "Tu agente está apagado: hoy contestas tú.";
  if (day.agent.length === 0) return "«Todo el día» es del plan Pro: con tu plan, tu agente no contesta.";
  if (day.allDay) return "Tu agente contesta todo el día.";
  if (now === null) return "Tu agente contesta cuando tu equipo no está.";
  const shift = day.agent.find(([a, b]) => now >= a && now < b);
  if (shift) {
    if (shift[1] < DAY) return `Ahora contesta tu agente, hasta las ${hhmm(shift[1])}.`;
    return day.tomorrow ? `Ahora contesta tu agente, hasta mañana a las ${hhmm(day.tomorrow)}.` : "Ahora contesta tu agente, hasta mañana.";
  }
  const next = day.agent.find(([a]) => a > now);
  return next ? `Ahora atiende tu equipo. Tu agente entra a las ${hhmm(next[0])}.` : "Ahora atiende tu equipo.";
}

/** Parte un tramo en lo que ya pasó y lo que falta. */
function split([a, b]: Span, now: number | null): [Span | null, Span | null] {
  if (now === null || now >= b) return [[a, b], null];
  if (now <= a) return [null, [a, b]];
  return [[a, now], [now, b]];
}

/**
 * Inicio · «Hoy, hora por hora». La firma de la pantalla: el día del negocio
 * como un horizonte en la tarjeta de tinta. Cada punto es una conversación de
 * hoy, en la columna de la hora en que el cliente escribió, con el color de su
 * estado; debajo, cuándo atiende tu equipo y cuándo tu agente. Lo único que se
 * mueve solo es el turno del agente que corre ahora: fluye hacia adelante y
 * dice «está trabajando». Lo que falta del día queda tenue.
 */
export function DayLine({ day, timezone, owner }: { day: Day; timezone: string; owner: boolean }) {
  // La hora vive en el cliente: el servidor no sabe cuándo se mira la pantalla.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(minuteInTz(new Date(), timezone));
    tick();
    const timer = setInterval(tick, 30_000);
    return () => clearInterval(timer);
  }, [timezone]);

  // Columnas de media hora; en el teléfono de una hora, para que los puntos
  // se apilen en vez de pisarse.
  const plot = useRef<HTMLDivElement>(null);
  const [slot, setSlot] = useState(30);
  useLayoutEffect(() => {
    const el = plot.current;
    if (!el) return;
    const measure = () => setSlot(el.clientWidth < 640 ? 60 : 30);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const stacks = new Map<number, number>();
  const dots = day.points.map((p, i) => {
    const column = Math.floor(p.minute / slot);
    const level = stacks.get(column) ?? 0;
    stacks.set(column, level + 1);
    return { ...p, column, level, i };
  });
  const counts = { activo: 0, atendiendo: 0, atencion: 0, pausado: 0 } as Record<SystemState, number>;
  for (const p of day.points) counts[p.state]++;
  const agentState: SystemState = day.agentOn ? "activo" : "pausado";

  let action: { href: string; label: string } | null = null;
  if (owner && !day.configured) action = { href: "/agent", label: "Definir horario" };
  else if (owner && day.agentOn && day.agent.length === 0) action = { href: "/settings/billing", label: "Ver planes" };
  else if (owner) action = { href: "/agent", label: "Cambiar horario" };

  return (
    <div className="border-b px-5 py-5 md:px-7">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <h2 className="kicker">Hoy, hora por hora</h2>
        <ul aria-hidden className="flex items-center gap-4 text-[11.5px] text-text-3">
          <li className="flex items-center gap-1.5">
            <span className="h-2 w-4 rounded-full bg-[var(--rule)]" />
            Tu equipo
          </li>
          <li className="flex items-center gap-1.5" data-state={agentState}>
            <svg width="18" height="4" className="overflow-visible">
              <line x1="2" x2="18" y1="2" y2="2" stroke="var(--st)" strokeWidth="3" strokeLinecap="round" strokeDasharray="0 6" />
            </svg>
            Tu agente
          </li>
        </ul>
      </div>

      <p className="sr-only">
        {day.points.length === 0
          ? "Hoy todavía no escribió nadie."
          : `Hoy escribieron ${day.points.length}: ${counts.activo} respondidas, ${counts.atendiendo} en curso, ${counts.atencion} esperan por ti.`}
      </p>

      <div ref={plot} aria-hidden className="relative mt-3 h-[112px] select-none">
        {/* Dónde estamos. La animación va en un hijo: pisaría el translate que centra la etiqueta. */}
        {now !== null && (
          <>
            <span className="ak-enter absolute top-[18px] w-px bg-[var(--rule)]" style={{ left: at(now), bottom: 16 }} />
            <span
              className={cn(
                "absolute top-0 whitespace-nowrap font-mono text-[10.5px] text-text-2",
                now < DAY * 0.08 ? "" : now > DAY * 0.92 ? "-translate-x-full" : "-translate-x-1/2",
              )}
              style={{ left: at(now) }}
            >
              <span className="ak-enter block">ahora {hhmm(now)}</span>
            </span>
          </>
        )}

        {/* La regla: una marca por hora, más larga cada tres. */}
        {Array.from({ length: 25 }, (_, h) => (
          <span
            key={`marca-${h}`}
            className="absolute bottom-[14px] w-px bg-[var(--rule)]"
            style={{ left: at(h * 60), height: h % 3 === 0 ? 6 : 3 }}
          />
        ))}

        {/* La vía: una línea de pelo, el horario del equipo y el turno del agente. */}
        <span className="absolute inset-x-0 bottom-[27px] h-px bg-[var(--hairline)]" />
        {day.team.map((span) =>
          split(span, now).map(
            (part, k) =>
              part && (
                <span
                  key={`equipo-${span[0]}-${k}`}
                  className={cn("ak-grow-x absolute bottom-[23px] h-2 rounded-full bg-[var(--rule)]", k === 1 && now !== null && "opacity-50")}
                  style={{ left: at(part[0]), width: at(part[1] - part[0]) }}
                />
              ),
          ),
        )}
        {day.agent.map((span) =>
          split(span, now).map((part, k) => {
            if (!part) return null;
            // El turno que corre ahora fluye; lo que viene más tarde espera tenue.
            const live = k === 1 && day.agentOn && now !== null && now >= span[0];
            return (
              <svg
                key={`agente-${span[0]}-${k}`}
                data-state={agentState}
                className={cn("absolute bottom-[25px] h-1 overflow-visible", k === 1 && !live && now !== null && "opacity-40")}
                style={{ left: at(part[0]), width: at(part[1] - part[0]) }}
              >
                <line
                  x1="3"
                  x2="100%"
                  y1="2"
                  y2="2"
                  stroke="var(--st)"
                  strokeWidth="3"
                  strokeLinecap="round"
                  className={live ? "ak-flow" : undefined}
                  strokeDasharray={live ? undefined : "0 12"}
                />
              </svg>
            );
          }),
        )}

        {/* Las conversaciones de hoy: caen a su hora, en el color de su estado. */}
        {dots.map((d) =>
          d.level < MAX_STACK ? (
            <Link
              key={d.id}
              href={`/inbox?contact=${d.contactId}`}
              tabIndex={-1}
              title={`${d.name} · ${NOTE[d.state]} · ${hhmm(d.minute)}`}
              className="ak-drop group absolute grid place-items-center transition-[left,bottom] duration-500"
              style={{
                left: `calc(${at((d.column + 0.5) * slot)} - ${DOT / 2 + 3}px)`,
                bottom: BASE - 3 + d.level * PITCH,
                width: DOT + 6,
                height: DOT + 6,
                "--i": d.i,
              } as React.CSSProperties}
            >
              <span
                data-state={d.state}
                data-live={d.state === "atendiendo" || undefined}
                className="ak-dot transition-transform duration-200 group-hover:scale-150"
                style={{
                  width: DOT,
                  height: DOT,
                  boxShadow: d.state === "atencion" ? "0 0 0 3px color-mix(in srgb, var(--st) 30%, transparent)" : undefined,
                }}
              />
            </Link>
          ) : null,
        )}
        {[...stacks].map(([column, n]) =>
          n > MAX_STACK ? (
            <span
              key={`mas-${column}`}
              className="absolute -translate-x-1/2 font-mono text-[10px] text-text-3"
              style={{ left: at((column + 0.5) * slot), bottom: BASE + MAX_STACK * PITCH }}
            >
              <span className="ak-enter block">+{n - MAX_STACK}</span>
            </span>
          ) : null,
        )}
        {day.points.length === 0 && (
          <p className="absolute inset-x-0 top-[34px] text-center text-[13px] text-text-3">
            Cuando alguien escriba, aparece aquí como un punto.
          </p>
        )}

        {[0, 3, 6, 9, 12, 15, 18, 21, 24].map((h) => (
          <span
            key={h}
            className={cn(
              "absolute bottom-0 font-mono text-[10px] leading-none text-text-3",
              h === 0 ? "" : h === 24 ? "-translate-x-full" : "-translate-x-1/2",
              h % 6 !== 0 && "hidden sm:block",
            )}
            style={{ left: at(h * 60) }}
          >
            {String(h).padStart(2, "0")}
          </span>
        ))}
      </div>

      <p className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[13.5px] text-text-2">
        <span>{sentence(day, now)}</span>
        {action && (
          <Link href={action.href} className="font-medium text-foreground underline-offset-4 hover:underline">
            {action.label}
          </Link>
        )}
      </p>
    </div>
  );
}

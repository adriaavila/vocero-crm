"use client";

import { useState } from "react";
import { addDaysISO } from "@/lib/time/slots";
import { cn } from "@/lib/utils";

export type Range = { from: string; to: string };

const MAX_DAYS = 366;

/** Días de calendario entre dos fechas ISO, inclusivo. */
function diasEntre(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000
  ) + 1;
}

/** "America/Mexico_City" → "Mexico City": el ciudad, sin la ruta IANA completa. */
function nombreAmigable(tz: string): string {
  return tz.split("/").pop()?.replace(/_/g, " ") || tz;
}

/**
 * 019 — Selector de rango. Los atajos cubren casi todas las consultas reales;
 * las fechas sueltas están para la excepción. Todo se interpreta en la zona
 * del negocio del lado del servidor: aquí solo viajan fechas de calendario.
 */
export function RangePicker({
  value,
  onChange,
  today,
  timezone,
}: {
  value: Range;
  onChange: (r: Range) => void;
  /** `YYYY-MM-DD` de hoy en la zona del negocio. */
  today: string;
  timezone: string;
}) {
  const atajos = shortcuts(today);
  const activo = atajos.find(
    (a) => a.range.from === value.from && a.range.to === value.to
  );
  const [error, setError] = useState<string | null>(null);

  /** Fuera de aquí no hay onChange: mantiene el rango anterior y explica por qué. */
  function intentar(next: Range) {
    if (next.to < next.from) {
      setError("Hasta no puede ser antes de Desde.");
      return;
    }
    if (diasEntre(next.from, next.to) > MAX_DAYS) {
      setError(`El rango máximo es de ${MAX_DAYS} días.`);
      return;
    }
    setError(null);
    onChange(next);
  }

  const inputClase = cn(
    "h-11 rounded-md border border-input bg-background px-2 text-xs text-foreground sm:h-8",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    error && "border-danger-soft"
  );

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex flex-wrap gap-1" role="group" aria-label="Periodo">
        {atajos.map((a) => (
          <button
            key={a.label}
            type="button"
            aria-pressed={activo?.label === a.label}
            onClick={() => onChange(a.range)}
            className={cn(
              "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              activo?.label === a.label
                ? "border-brand bg-brand-tint text-brand-text"
                : "text-text-2 hover:bg-accent hover:text-foreground"
            )}
          >
            {a.label}
          </button>
        ))}
      </div>
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-1.5 text-xs text-text-3">
          <input
            type="date"
            value={value.from}
            onChange={(e) => e.target.value && intentar({ ...value, from: e.target.value })}
            className={inputClase}
            aria-label="Desde"
            aria-invalid={!!error}
            aria-describedby={error ? "rango-error" : undefined}
          />
          <span aria-hidden>a</span>
          <input
            type="date"
            value={value.to}
            onChange={(e) => e.target.value && intentar({ ...value, to: e.target.value })}
            className={inputClase}
            aria-label="Hasta"
            aria-invalid={!!error}
            aria-describedby={error ? "rango-error" : undefined}
          />
        </div>
        {error && (
          <p id="rango-error" role="alert" className="text-[11px] text-danger-text">
            {error}
          </p>
        )}
      </div>
      <span className="text-[11px] text-text-3">Días de {nombreAmigable(timezone)}</span>
    </div>
  );
}

/**
 * Los atajos se calculan sobre el "hoy" del NEGOCIO, que llega resuelto del
 * servidor: con la fecha del navegador, un dueño revisando de noche desde
 * otra zona pediría un rango que no es el suyo, y el servidor y el cliente
 * pintarían atajos distintos en el primer render.
 */
export function shortcuts(hoy: string): { label: string; range: Range }[] {
  const menos = (n: number) => addDaysISO(hoy, -n);
  const primeroDeMes = `${hoy.slice(0, 8)}01`;
  const finMesPasado = addDaysISO(primeroDeMes, -1);
  const iniMesPasado = `${finMesPasado.slice(0, 8)}01`;

  return [
    { label: "7 días", range: { from: menos(6), to: hoy } },
    { label: "30 días", range: { from: menos(29), to: hoy } },
    { label: "Este mes", range: { from: primeroDeMes, to: hoy } },
    { label: "Mes pasado", range: { from: iniMesPasado, to: finMesPasado } },
    { label: "90 días", range: { from: menos(89), to: hoy } },
  ];
}

/** El rango por defecto: últimos 30 días. */
export function defaultRange(hoy: string): Range {
  return shortcuts(hoy)[1]!.range;
}

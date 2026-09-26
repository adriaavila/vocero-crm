"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { unitLabel, type RateDto, type UnitLabel } from "@/lib/analytics";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";

/**
 * Con la forma de lo que va a llegar (tarjetas + una franja de gráfica), no
 * un texto centrado: eso es lo que más mueve el layout cuando el dato real
 * aparece (CLS). Aproximado a propósito — sirve para las cuatro secciones,
 * no hay una por cada una.
 */
function EsqueletoDeSeccion() {
  return (
    <div className="space-y-4" aria-hidden>
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 sm:gap-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="space-y-2 rounded-md border bg-subtle px-3 py-2.5">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-5 w-12" />
          </div>
        ))}
      </div>
      <Skeleton className="h-32 w-full" />
    </div>
  );
}

/**
 * 019 — Contenedor de cada bloque de Resultados. Cada sección carga por su
 * cuenta: una lenta no retrasa a las demás y una rota no deja la pantalla en
 * blanco.
 *
 * Al cambiar el rango, lo anterior se queda a la vista atenuado hasta que
 * llega lo nuevo: vaciar la sección en cada cambio la haría saltar y
 * parpadear justo mientras el dueño compara.
 */
export function Section({
  title,
  hint,
  loading,
  error,
  hasData,
  empty,
  emptyText,
  right,
  children,
  id,
  onRetry,
}: {
  title: string;
  hint?: string;
  loading: boolean;
  error?: string | null;
  /** Hay datos que pintar (aunque estén recargándose). */
  hasData: boolean;
  empty?: boolean;
  emptyText?: string;
  right?: ReactNode;
  children: ReactNode;
  id?: string;
  /** Sin esto, un error se queda sin salida más que recargar la página entera. */
  onRetry?: () => void;
}) {
  return (
    <section
      id={id}
      aria-busy={loading}
      className="rounded-lg border border-border-strong bg-card shadow-sm"
    >
      <header className="flex flex-wrap items-start justify-between gap-2 border-b px-4 py-3 sm:px-5">
        <div className="min-w-0">
          <h3 className="text-[15px] font-bold tracking-tight">{title}</h3>
          {hint && <p className="mt-0.5 text-xs text-text-3">{hint}</p>}
        </div>
        {right}
      </header>
      <div
        className={cn(
          "p-4 transition-opacity sm:p-5",
          loading && hasData && "opacity-60"
        )}
      >
        {error ? (
          <div role="alert" className="flex flex-col items-center gap-2 py-6 text-center text-sm">
            <p className="text-danger-text">{error}</p>
            {onRetry && (
              <Button variant="outline" size="sm" onClick={onRetry}>
                Reintentar
              </Button>
            )}
          </div>
        ) : !hasData ? (
          <EsqueletoDeSeccion />
        ) : empty ? (
          <p className="py-6 text-center text-sm text-text-3">
            {emptyText ?? "No hay datos en este periodo."}
          </p>
        ) : (
          children
        )}
      </div>
    </section>
  );
}

/**
 * Una tasa NUNCA se muestra sola: siempre con el número que la sostiene, y
 * marcada cuando la muestra es chica.
 */
export function Rate({
  rate,
  unit = "casos",
  className,
}: {
  rate: RateDto;
  unit?: UnitLabel;
  className?: string;
}) {
  if (rate.value === null) {
    return <span className={cn("text-text-3", className)}>sin datos</span>;
  }
  return (
    <span className={cn("inline-flex flex-wrap items-baseline gap-x-1.5", className)}>
      <span className={cn("font-medium", !rate.reliable && "text-text-2")}>
        {rate.value}%
      </span>
      <span className="text-xs text-text-3">
        de {rate.sample} {unitLabel(unit, rate.sample)}
        {!rate.reliable && " · muestra chica"}
      </span>
    </span>
  );
}

/** Subtítulo de un bloque dentro de una sección. */
export function Subhead({ children }: { children: ReactNode }) {
  return <h4 className="mb-2 text-[13px] font-semibold text-text-2">{children}</h4>;
}

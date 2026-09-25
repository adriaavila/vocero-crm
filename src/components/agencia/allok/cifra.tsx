import { cn } from "@/lib/utils";

/**
 * Una cifra que sube a su sitio, dígito por dígito (allok.fun, count-up). Es
 * solo CSS: se ve completa antes de que cargue el JS y no parpadea al
 * hidratar. Cuando cambia (entró otro mensaje) vuelve a subir, así el número
 * nuevo se nota.
 */
export function Cifra({ value, className }: { value: number | string; className?: string }) {
  const text = String(value);
  return (
    <span className={cn("inline-flex overflow-hidden", className)}>
      <span className="sr-only">{text}</span>
      {[...text].map((ch, i) => (
        <span key={`${text}:${i}`} aria-hidden className="ak-count" style={{ "--i": i } as React.CSSProperties}>
          {ch}
        </span>
      ))}
    </span>
  );
}

/**
 * Qué parte de un total, como anillo que se cierra (Inicio: atendidas solas de
 * las de hoy). El arco es del verde de estado: lo que allok resolvió.
 */
export function Anillo({ value, of, className }: { value: number; of: number; className?: string }) {
  const pct = of > 0 ? Math.min(100, (value / of) * 100) : 0;
  return (
    <svg
      viewBox="0 0 36 36"
      data-state="activo"
      role="img"
      aria-label={`${Math.round(pct)} %`}
      className={cn("h-7 w-7 shrink-0 -rotate-90 md:h-8 md:w-8", className)}
    >
      <circle cx="18" cy="18" r="14" fill="none" stroke="color-mix(in srgb, var(--text) 18%, transparent)" strokeWidth="4" />
      <circle
        cx="18"
        cy="18"
        r="14"
        fill="none"
        stroke="var(--st)"
        strokeWidth="4"
        strokeLinecap="round"
        pathLength={100}
        strokeDasharray="100 100"
        className="ak-draw"
        style={{ strokeDashoffset: 100 - pct }}
      />
    </svg>
  );
}

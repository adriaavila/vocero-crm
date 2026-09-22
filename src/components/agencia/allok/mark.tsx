import { STATE_LABEL, type SystemState } from "@/lib/estado";
import { cn } from "@/lib/utils";

/**
 * El punto de estado. El color sale de `data-state` (globals.css), así que
 * dentro de un trozo de tinta ya se pinta en su versión oscura. Late solo
 * mientras algo está en vuelo (`atendiendo`).
 */
export function StateDot({
  state,
  size = 8,
  className,
  decorative = false,
}: {
  state: SystemState;
  size?: number;
  className?: string;
  /** `true` cuando el estado ya está escrito al lado: no se anuncia dos veces. */
  decorative?: boolean;
}) {
  return (
    <span
      data-state={state}
      data-live={state === "atendiendo" || undefined}
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : STATE_LABEL[state]}
      aria-hidden={decorative || undefined}
      className={cn("ak-dot", className)}
      style={{ width: size, height: size }}
    />
  );
}

/**
 * `all ● k` — el logotipo con el estado dentro (allok.fun, AllokLogo). El punto
 * ocupa el sitio de la `o`, así que no se puede pintar sin decir cómo está el
 * sistema: en verde, literalmente se lee «all ok». Las letras van en
 * `currentColor`: tinta sobre Cloud, Cloud sobre tinta.
 */
export function AllokWordmark({
  state,
  size = 24,
  className,
}: {
  state: SystemState;
  /** Tamaño de la letra en px; el punto y el aire salen de acá. */
  size?: number;
  className?: string;
}) {
  return (
    <span
      role="img"
      aria-label={`allok · ${STATE_LABEL[state]}`}
      className={cn("inline-flex shrink-0 items-center leading-none", className)}
      style={{ fontSize: size, fontWeight: 800, letterSpacing: "-0.055em" }}
    >
      <span aria-hidden>all</span>
      <StateDot state={state} size={Math.round(size * 0.6)} decorative className="mx-[0.02em]" />
      <span aria-hidden style={{ marginLeft: size * 0.04 }}>
        k
      </span>
    </span>
  );
}

import { STATE_LABEL, STATE_MOTION, type SystemState } from "@/lib/estado";
import { cn } from "@/lib/utils";

type Motion = (typeof STATE_MOTION)[SystemState] | "secuencia";

/**
 * El punto de estado. El color sale de `data-state` (globals.css), así que
 * dentro de un trozo de tinta ya se pinta en su versión oscura. El punto chico
 * de una lista late solo mientras algo está en vuelo (`atendiendo`).
 *
 * Con `motion` es el punto de allok.fun: el tramo de su estado (respira, gira
 * o se cierra en punto), o `secuencia`, los tres seguidos una vez. Solo de
 * 12 px para arriba: más chico, el anillo no se lee. Cambia de estado → vuelve
 * a entrar, así que volver a «all ok» se ve: el anillo se cierra en punto.
 */
export function StateDot({
  state,
  size = 8,
  className,
  decorative = false,
  motion,
}: {
  state: SystemState;
  size?: number;
  className?: string;
  /** `true` cuando el estado ya está escrito al lado: no se anuncia dos veces. */
  decorative?: boolean;
  motion?: true | Motion;
}) {
  const a11y = {
    role: decorative ? undefined : "img",
    "aria-label": decorative ? undefined : STATE_LABEL[state],
    "aria-hidden": decorative || undefined,
  };
  if (motion) {
    const tramo = motion === true ? STATE_MOTION[state] : motion;
    return (
      <span
        key={`${state}-${tramo}`}
        data-state={state}
        data-motion={tramo}
        className={cn("ak-live", className)}
        style={{ width: size, height: size }}
        {...a11y}
      >
        <svg viewBox="0 0 64 64" aria-hidden focusable="false">
          <circle className="ak-live-ring" cx="32" cy="32" r="18" pathLength={100} />
          <circle className="ak-live-fill" cx="32" cy="32" r="18" />
        </svg>
      </span>
    );
  }
  return (
    <span
      data-state={state}
      data-live={state === "atendiendo" || undefined}
      className={cn("ak-dot", className)}
      style={{ width: size, height: size }}
      {...a11y}
    />
  );
}

/**
 * `all ● k` — el logotipo con el estado dentro (allok.fun, AllokLogo). El punto
 * ocupa el sitio de la `o`, así que no se puede pintar sin decir cómo está el
 * sistema: en verde, literalmente se lee «all ok». Como en la web, el punto se
 * mueve según el estado. Las letras van en `currentColor`: tinta sobre Cloud,
 * Cloud sobre tinta.
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
      <StateDot state={state} size={Math.round(size * 0.6)} decorative motion className="mx-[0.02em]" />
      <span aria-hidden style={{ marginLeft: size * 0.04 }}>
        k
      </span>
    </span>
  );
}

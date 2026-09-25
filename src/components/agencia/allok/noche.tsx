import { StateDot } from "./mark";

const COLS = 24;
const ROWS = 6;

/** Azar con semilla fija: el tablero sale igual en el servidor y en el navegador. */
function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DOTS = (() => {
  const rand = seeded(22);
  return Array.from({ length: COLS * ROWS }, () => {
    const r = rand();
    // Tres de cada diez conversaciones se mueven a la vez; una de cada tanto te toca.
    const run = r < 0.28 ? "allok" : r < 0.32 ? "tu" : undefined;
    return { run, d: 6 + rand() * 5, at: -(rand() * 11) };
  });
})();

/**
 * La portada del login: una noche cualquiera, en el código de color de la
 * marca. Cada punto es una conversación que llega; allok la atiende (azul) y
 * queda resuelta (verde). Una de cada tanto te toca a ti (ámbar) antes de
 * cerrarse. Es la promesa, no un dato: no lleva ni una cifra.
 */
export function NightBoard() {
  return (
    <figure className="mt-10 max-w-[30rem]">
      <figcaption className="kicker">Mientras duermes</figcaption>
      <div
        aria-hidden
        className="mt-4 grid gap-y-2.5"
        style={{ gridTemplateColumns: `repeat(${COLS}, minmax(0, 1fr))` }}
      >
        {DOTS.map((dot, i) => (
          <span key={i} className="grid place-items-center">
            <span
              className="ak-night block h-1.5 w-1.5 rounded-full"
              data-run={dot.run}
              style={{ "--d": `${dot.d.toFixed(2)}s`, "--at": `${dot.at.toFixed(2)}s` } as React.CSSProperties}
            />
          </span>
        ))}
      </div>
      <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-[12.5px] text-text-2">
        <li className="flex items-center gap-2">
          <StateDot state="atendiendo" size={7} decorative />
          allok atiende
        </li>
        <li className="flex items-center gap-2">
          <StateDot state="activo" size={7} decorative />
          Resuelta
        </li>
        <li className="flex items-center gap-2">
          <StateDot state="atencion" size={7} decorative />
          Te toca a ti
        </li>
      </ul>
    </figure>
  );
}

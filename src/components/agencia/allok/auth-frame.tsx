import { AllokWordmark, StateDot } from "./mark";
import { NightBoard } from "./noche";

const VOICE = ["Cada lead, atendido.", "Todo conectado. Todo bajo control.", "Siempre encendido."];

/**
 * Entrada del SaaS allok: la portada de allok.fun partida en dos. A la
 * izquierda, en tinta, el anuncio de la marca en tres líneas —la tercera es el
 * logotipo diciendo su estado—; a la derecha, en Cloud, el formulario.
 *
 * Acá no hay un negocio del que saber el estado todavía: el punto va en
 * `activo` como en la landing, que es la promesa, no un dato.
 */
export function AllokAuthFrame({ children }: { children: React.ReactNode }) {
  return (
    <main className="grid min-h-dvh bg-subtle lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <aside className="ak-ink relative hidden flex-col justify-between overflow-hidden bg-[var(--ground)] px-12 py-11 lg:flex xl:px-16">
        <AllokWordmark state="activo" size={34} />

        <div className="max-w-[30rem]">
          <p className="kicker">The AI harness for WhatsApp</p>
          <div className="mt-6 text-[clamp(2.2rem,3.6vw,3.25rem)] font-bold leading-[1.08] tracking-[-0.04em]">
            <p>Te fuiste a dormir.</p>
            <p className="text-ink-40">Tu WhatsApp no.</p>
            <p className="mt-1 flex items-center gap-3">
              {/* El punto cuenta la historia entera una vez: espera, atiende, resuelve. */}
              <StateDot state="activo" size={18} decorative motion="secuencia" />
              <span>all ok</span>
            </p>
          </div>
          <p className="mt-7 max-w-[26rem] text-[16px] leading-relaxed text-text-2">
            allok contesta con lo que de verdad vendes, pregunta lo que hay que preguntar y
            agenda la cita. Tú ves lo que pasó y decides cuándo entrar.
          </p>
          <NightBoard />
        </div>

        <ul className="grid gap-2.5 text-[14px] text-text-2">
          {VOICE.map((line) => (
            <li key={line} className="flex items-center gap-2.5">
              <StateDot state="activo" size={6} decorative />
              {line}
            </li>
          ))}
          <li className="mt-3 font-mono text-[10.5px] uppercase tracking-[0.14em] text-text-3">
            Configurar nunca le escribe a tus clientes
          </li>
        </ul>
      </aside>

      <div className="flex min-h-dvh flex-col items-center justify-center px-4 py-10 sm:px-8">
        <div className="mb-9 flex flex-col items-center gap-3 text-center lg:hidden">
          <AllokWordmark state="activo" size={36} />
          <p className="max-w-xs text-[14px] text-text-2">Te fuiste a dormir. Tu WhatsApp no.</p>
        </div>
        <div className="w-full max-w-sm">{children}</div>
      </div>
    </main>
  );
}

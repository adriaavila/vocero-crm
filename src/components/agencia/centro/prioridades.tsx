import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { StateDot } from "@/components/agencia/allok/mark";
import type { PriorityCard, Prioridades } from "@/server/agencia/prioridades";

/**
 * Inicio · «Por dónde arrancar»: las conversaciones que esperan por una
 * persona, la que se pierde antes primero, con una sola acción cada una. En el
 * teléfono se deslizan de lado; en escritorio son una rejilla. Cada estado es
 * punto + palabra (la palabra aquí es lo que le queda a la ventana de 24 h).
 */
export function PrioridadesSection({
  data,
  productLabel,
  connected,
  hasDecisions,
}: {
  data: Prioridades;
  productLabel: string;
  /** Sin WhatsApp conectado no hay conversaciones que esperar: la frase vacía lo dice. */
  connected: boolean;
  /** Hay decisiones del agente que mirar: si no, el enlace no lleva a nada. */
  hasDecisions: boolean;
}) {
  const { cards, total } = data;
  return (
    <section aria-labelledby="prioridades-titulo" className="mt-8">
      <div className="flex items-center justify-between gap-4">
        <h2 id="prioridades-titulo" className="kicker">
          Por dónde arrancar
        </h2>
        {total > 0 && (
          <Link href="/inbox" className="inline-flex min-h-11 items-center gap-1 text-[12.5px] font-medium text-text-2 hover:text-foreground [@media(pointer:fine)]:min-h-0">
            Ver todas <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        )}
      </div>

      {cards.length > 0 ? (
        <ul className="-mx-4 mt-3 flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-px-4 px-4 pb-3 [scrollbar-width:none] md:mx-0 md:grid md:grid-cols-2 md:overflow-visible md:px-0 md:pb-0 xl:grid-cols-4 [&::-webkit-scrollbar]:hidden">
          {cards.map((card, i) => (
            <li key={card.conversationId} className="ak-enter w-[78vw] max-w-[320px] shrink-0 snap-start md:w-auto md:max-w-none" style={{ "--i": Math.min(i, 8) } as React.CSSProperties}>
              <PrioridadCard card={card} productLabel={productLabel} primary={i === 0} />
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-3 flex items-start gap-3 rounded-lg border bg-background px-5 py-5">
          <StateDot state={connected ? "activo" : "pausado"} size={10} decorative className="mt-1.5" />
          <p className="text-[14px] leading-relaxed text-text-2">
            {connected
              ? "Nada por atender. Cuando un cliente escriba y nadie le conteste, aparece aquí primero."
              : "Conecta tu WhatsApp y las conversaciones que esperan por ti aparecen aquí."}
          </p>
        </div>
      )}

      {hasDecisions && (
        <Link href="/decisiones" className="mt-2 inline-flex min-h-11 items-center gap-1.5 text-[13.5px] font-medium text-text-2 hover:text-foreground">
        Ver cómo decidió el agente <ArrowRight className="h-4 w-4" aria-hidden />
      </Link>
      )}
    </section>
  );
}

function PrioridadCard({ card, productLabel, primary }: { card: PriorityCard; productLabel: string; primary: boolean }) {
  // Con menos de una hora el aviso pesa más: el verbo cambia («Se cierra en…») y va en negrita.
  const urgent = card.windowOpen && card.remainingMs < 3_600_000;
  return (
    <article className="relative flex h-full flex-col rounded-lg border bg-background p-4 transition-[border-color] hover:border-border-strong focus-within:border-foreground">
      <p data-state={card.state} className={`flex items-center gap-2 font-mono text-[11.5px] text-[var(--st-ink)] ${urgent ? "font-bold" : ""}`}>
        <StateDot state={card.state} size={8} decorative />
        <span>{card.windowLabel}</span>
      </p>
      <h3 title={card.name} className="mt-3 truncate text-[15px] font-semibold tracking-[-0.01em]">
        {card.name}
      </h3>
      <p className="mt-0.5 text-[13.5px] font-medium">{card.reasonLabel}</p>
      {card.reasonDetail && <p className="text-[12.5px] leading-snug text-text-3">{card.reasonDetail}</p>}
      {card.preview && <p className="mt-2 line-clamp-2 break-words text-[13.5px] leading-snug text-text-2">{card.preview}</p>}
      <div className="mt-auto flex items-center justify-between gap-3 pt-4">
        {/* Solo se rotula cuando allok es quien contesta; si no, la tarjeta es tuya y no hace falta decirlo. */}
        {card.handler === "agente" ? (
          <span data-state="atendiendo" className="min-w-0 truncate text-[12.5px] text-[var(--st-ink)]">{productLabel} la está contestando</span>
        ) : (
          <span />
        )}
        <Link
          href={`/inbox?contact=${card.contactId}`}
          aria-label={`Responder a ${card.name}`}
          className={`${buttonVariants({ size: "lg", variant: primary ? "default" : "outline" })} min-h-11 shrink-0 px-4 after:absolute after:inset-0 after:content-[''] [@media(pointer:fine)]:min-h-10`}
        >
          Responder
        </Link>
      </div>
    </article>
  );
}

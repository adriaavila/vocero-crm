import { ESTADO_LABEL, ESTADO_TONO, type EstadoPedido } from "@/lib/restaurante/pedido";
import { cn } from "@/lib/utils";

/** El estado de un pedido: un punto y su nombre. El color ES el estado. */
export function EstadoPill({ estado, className }: { estado: EstadoPedido; className?: string }) {
  return (
    <span
      data-state={ESTADO_TONO[estado]}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border border-[var(--st-soft,var(--border))] bg-[var(--st-soft,var(--bg-subtle))] px-2.5 py-1 text-[12px] font-medium leading-none text-[var(--st-ink,var(--text-2))]",
        className
      )}
    >
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-[var(--st,var(--text-3))]" />
      {ESTADO_LABEL[estado]}
    </span>
  );
}

/** «Prueba»: un pedido de una conversación de prueba. No cuenta ni sale a WhatsApp. */
export function PruebaTag() {
  return (
    <span className="rounded-full border border-dashed border-border-strong px-2 py-0.5 text-[11px] font-medium uppercase tracking-[0.06em] text-text-3">
      Prueba
    </span>
  );
}

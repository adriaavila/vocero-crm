"use client";

import { cn } from "@/lib/utils";

type SwitchProps = {
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
  /** Lo que enciende. Va a `aria-label`: el interruptor no tiene texto propio. */
  label: string;
  disabled?: boolean;
  className?: string;
};

/**
 * El interruptor de la app. Uno solo, para que «encendido» se vea igual en
 * todas partes: pista de 44 × 24 con la perilla de 20, y un área táctil de
 * 44 px de alto alrededor (el botón), aunque lo que se ve sea más chico.
 *
 * El color no vive aquí: fuera del SaaS es `primary` / `border-strong`; en el
 * SaaS lo pinta `globals.css` sobre `[data-switch-track]` (verde de estado
 * encendido, perilla en tinta).
 */
export function Switch({ checked, onCheckedChange, label, disabled, className }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "group inline-flex h-11 shrink-0 items-center justify-center px-1.5 outline-none disabled:cursor-not-allowed",
        className
      )}
    >
      <span
        data-switch-track
        className={cn(
          "relative h-6 w-11 rounded-full transition-colors duration-200 ease-out group-focus-visible:ring-2 group-focus-visible:ring-ring group-focus-visible:ring-offset-2 group-focus-visible:ring-offset-background group-disabled:opacity-40",
          checked ? "bg-primary" : "bg-text-3"
        )}
      >
        <span
          data-switch-knob
          className={cn(
            "absolute left-0.5 top-0.5 size-5 rounded-full bg-knob shadow-sm transition-transform duration-200 ease-out motion-reduce:transition-none",
            checked && "translate-x-5"
          )}
        />
      </span>
    </button>
  );
}

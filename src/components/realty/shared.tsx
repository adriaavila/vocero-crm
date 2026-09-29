"use client";

import type { PropertyStatus } from "@/lib/realty/catalog";
import { cn } from "@/lib/utils";

/** Piezas compartidas del catálogo de propiedades (vertical inmobiliario). */

/**
 * Mensaje de error listo para pintar. La API interna responde
 * `{error:{code,message}}`; cuando ni eso llega, el usuario merece saber que
 * fue la red y no un dato suyo.
 */
export async function apiErrorMessage(
  res: Response | null,
  fallback = "No se pudo completar la operación"
): Promise<string> {
  if (!res) return "Sin conexión con el servidor";
  const data = (await res.json().catch(() => null)) as {
    error?: { message?: string };
  } | null;
  return data?.error?.message ?? fallback;
}

/*
 * Gradientes del placeholder. Se escriben literales (y no compuestos en
 * runtime) porque Tailwind solo compila las clases que ve en el código.
 */
const PLACEHOLDER_GRADIENTS = [
  "from-[#dfe6ee] to-[#bcc7d6]",
  "from-[#e2e7e2] to-[#c2ccc2]",
  "from-[#eae4dc] to-[#cec3b5]",
  "from-[#e6e1ea] to-[#c8c0d2]",
  "from-[#dee8e8] to-[#b9caca]",
  "from-[#ece2e0] to-[#d3bfbb]",
  "from-[#e3e5ea] to-[#c3c7d1]",
  "from-[#e7e9e0] to-[#c9cdba]",
] as const;

/**
 * Fondo ESTABLE por propiedad: el mismo id pinta siempre el mismo gradiente,
 * así el inventario sin fotos no cambia de aspecto en cada recarga.
 */
export function placeholderGradient(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return (
    PLACEHOLDER_GRADIENTS[hash % PLACEHOLDER_GRADIENTS.length] ??
    PLACEHOLDER_GRADIENTS[0]
  );
}

export const STATUS_BADGE_VARIANT: Record<
  PropertyStatus,
  "success" | "warning" | "secondary"
> = {
  disponible: "success",
  apartada: "warning",
  cerrada: "secondary",
};

/** Píldora de filtro del catálogo. 44px de alto para el objetivo táctil. */
export function FilterPill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex min-h-8 items-center rounded-full border px-2.5 text-xs transition-colors",
        active
          ? "border-brand-soft bg-brand-tint font-semibold text-brand-text"
          : "border-border-strong text-text-2 hover:bg-accent"
      )}
    >
      {children}
    </button>
  );
}

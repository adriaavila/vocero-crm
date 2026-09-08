import type { Branding } from "@/lib/branding";
import { faviconInitial } from "@/lib/favicon";
import { cn } from "@/lib/utils";

/**
 * Mosaico cuadrado con degradado del acento: es el favicon en grande.
 * Siempre lleva la inicial del nombre configurado (Configuración → Marca).
 */
export function BrandTile({
  branding,
  className,
}: {
  branding: Pick<Branding, "name">;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "brand-tile flex shrink-0 items-center justify-center text-brand-fg",
        className
      )}
      aria-hidden
    >
      <span className="font-bold leading-none">{faviconInitial(branding.name)}</span>
    </span>
  );
}

const TILE_SIZE = {
  md: "h-[30px] w-[30px] rounded-[9px] text-[15px]",
  lg: "h-[44px] w-[44px] rounded-[13px] text-[22px]",
} as const;

/**
 * La marca completa: mosaico con la inicial + el nombre configurado
 * (Configuración → Marca).
 */
export function BrandLogo({
  branding,
  size = "md",
  className,
}: {
  branding: Pick<Branding, "name">;
  size?: keyof typeof TILE_SIZE;
  className?: string;
}) {
  return (
    <span className={cn("flex min-w-0 items-center gap-2.5", className)}>
      <BrandTile branding={branding} className={TILE_SIZE[size]} />
      <span
        className={cn(
          "truncate font-[750] leading-none tracking-tight",
          size === "lg" ? "text-[26px]" : "text-[17px]"
        )}
      >
        {branding.name}
      </span>
    </span>
  );
}

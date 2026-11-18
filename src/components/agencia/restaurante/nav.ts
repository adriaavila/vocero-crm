import { ClipboardList, UtensilsCrossed } from "lucide-react";

/**
 * Fork — vertical restaurante: sus dos entradas del menú lateral. Van justo
 * después de Conversaciones: son el trabajo de cada noche, no un reporte.
 */
export const RESTAURANTE_NAV: { href: string; label: string; icon: typeof ClipboardList; badge?: boolean; owner?: boolean }[] = [
  { href: "/pedidos", label: "Pedidos", icon: ClipboardList },
  { href: "/menu", label: "Menú", icon: UtensilsCrossed },
];

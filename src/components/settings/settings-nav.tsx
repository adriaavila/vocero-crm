"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/settings/whatsapp", label: "WhatsApp" },
  { href: "/settings/calendar", label: "Calendario" },
  { href: "/settings/branding", label: "Marca" },
  { href: "/settings/templates", label: "Plantillas" },
  { href: "/settings/team", label: "Equipo" },
] as const;

export function SettingsNav() {
  const pathname = usePathname();
  return (
    <nav className="flex w-full shrink-0 gap-1 overflow-x-auto border-b p-2 md:block md:w-44 md:space-y-1 md:border-b-0 md:border-r md:p-3">
      {TABS.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          className={cn(
            "block min-h-11 shrink-0 rounded-md px-3 py-3 text-sm font-medium transition-colors md:min-h-0 md:py-2",
            pathname.startsWith(t.href)
              ? "bg-brand-tint text-brand-text"
              : "text-muted-foreground hover:bg-accent hover:text-foreground"
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

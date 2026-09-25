"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import type { Branding } from "@/lib/branding";
import type { ThemePreference } from "@/lib/theme";
import { AppNav } from "@/components/app-nav";
import { BrandLogo } from "@/components/brand-mark";
import type { SaaSPlan } from "@/server/saas/billing";
import type { SystemSnapshot } from "@/lib/estado";
// Capa de agencia: el estado de la operación vive en todo el cascarón del SaaS.
import { SystemStateProvider } from "@/components/agencia/allok/system-state";
import { AllokShellBrand } from "@/components/agencia/allok/nav-head";

/**
 * Cascarón de la app en dos modos:
 *
 * - Escritorio (lg+): el panel lateral es una columna fija, como siempre.
 * - Móvil/tableta: el lateral sale de la izquierda como cajón sobre un velo,
 *   y arriba queda una barra con el hamburguesa y la marca. El cajón se cierra
 *   solo al navegar (el `pathname` cambia) y con Escape.
 *
 * La altura usa `100dvh` (no `100vh`) porque en el navegador móvil la barra de
 * direcciones se encoge al hacer scroll: con `vh` el compositor de la Bandeja
 * queda debajo del borde visible.
 */
export function AppShell({
  branding,
  userName,
  role,
  theme,
  commit,
  agenda = false,
  saasMode = false,
  saasPlan = null,
  systemState = null,
  children,
}: {
  branding: Branding;
  userName: string;
  role: string;
  theme: ThemePreference;
  /** Commit resuelto en el servidor (build-arg o variable de la plataforma). */
  commit?: string;
  /** 015 — ¿esta instancia tiene agenda? Lo decide el servidor. */
  agenda?: boolean;
  /** La navegación Allok reduce el CRM a las cuatro acciones principales. */
  saasMode?: boolean;
  saasPlan?: SaaSPlan | null;
  /** Capa de agencia: el estado resuelto en el servidor; null sin la marca allok. */
  systemState?: SystemSnapshot | null;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [navOpen, setNavOpen] = useState(false);

  // Navegar = cerrar el cajón. Sin esto, tocar "Pipeline" deja el velo encima
  // de la pantalla recién cargada.
  useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!navOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setNavOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navOpen]);

  const pageLabel =
    pathname === "/overview"
      ? "Inicio"
      : pathname.startsWith("/inbox")
        ? "Conversaciones"
        : pathname.startsWith("/pipeline")
          ? "Ventas"
          : pathname.startsWith("/bookings")
            ? "Agenda"
            : pathname.startsWith("/settings")
              ? "Configuración"
              : pathname.startsWith("/lab")
                ? "Probar allok"
                : pathname.startsWith("/agent")
                  ? "Tu agente"
                  : "allok";

  const shell = (
    <div className="flex h-dvh overflow-hidden bg-background">
      <a
        href="#main-content"
        className="sr-only fixed left-3 top-3 z-[70] rounded-md bg-background px-3 py-2 text-sm font-semibold text-foreground shadow-pop focus:not-sr-only"
      >
        Saltar al contenido
      </a>
      {navOpen && (
        <button
          aria-label="Cerrar el menú"
          tabIndex={-1}
          onClick={() => setNavOpen(false)}
          className="fixed inset-0 z-40 bg-overlay lg:hidden"
        />
      )}

      <AppNav
        branding={branding}
        commit={commit}
        userName={userName}
        role={role}
        theme={theme}
        agenda={agenda}
        saasMode={saasMode}
        allokBrand={Boolean(systemState)}
        saasPlan={saasPlan}
        open={navOpen}
        onClose={() => setNavOpen(false)}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-1.5 border-b bg-background/90 px-2 backdrop-blur lg:hidden">
          <button
            onClick={() => setNavOpen(true)}
            aria-label="Abrir el menú"
            aria-expanded={navOpen}
            className="flex min-h-11 min-w-11 items-center justify-center rounded-md text-text-2 hover:bg-accent hover:text-foreground"
          >
            <Menu className="h-5 w-5" strokeWidth={1.8} />
          </button>
          {systemState ? <AllokShellBrand /> : <BrandLogo branding={branding} className="min-w-0 max-w-[9rem]" />}
          <span className="ml-auto border-l pl-3 text-sm font-semibold text-text-2">{pageLabel}</span>
        </header>

        <main id="main-content" tabIndex={-1} className="min-h-0 min-w-0 flex-1 overflow-hidden">{children}</main>
      </div>
    </div>
  );

  return systemState ? (
    <SystemStateProvider initial={systemState} customFavicon={Boolean(branding.favicon)}>
      {shell}
    </SystemStateProvider>
  ) : (
    shell
  );
}

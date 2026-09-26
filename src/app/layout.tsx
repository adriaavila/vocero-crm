import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import localFont from "next/font/local";
import { accentCssVariables, DEFAULT_BRANDING, SAAS_BRANDING } from "@/lib/branding";
import { brand } from "@/lib/brand";
import { faviconHref } from "@/lib/favicon";
import { normalizeThemePreference, THEME_COOKIE } from "@/lib/theme";
import { getBranding } from "@/server/branding";
import { isAllokBrand, isAllokSaaSMode, isLegacyAppHost } from "@/lib/tenant-host";
import { resolveLegacyOrganizationId, resolveOrganizationIdForHost } from "@/server/auth/on-signup";
import "./globals.css";
import "./rei-motion.css";

// Las tres voces de la marca, las mismas de vocerocrm.com. Los woff2 (subset
// latin) viven en ./fonts: el build no toca Google Fonts, que a veces devolvía
// URLs sin extensión y rompía next/font/google.
const archivo = localFont({
  src: "./fonts/archivo-100-900.woff2",
  weight: "100 900",
  variable: "--font-sans",
  display: "swap",
});
const instrumentSerif = localFont({
  src: [
    { path: "./fonts/instrument-serif-400.woff2", weight: "400", style: "normal" },
    { path: "./fonts/instrument-serif-400-italic.woff2", weight: "400", style: "italic" },
  ],
  variable: "--font-serif",
  display: "swap",
});
const plexMono = localFont({
  src: [
    { path: "./fonts/ibm-plex-mono-400.woff2", weight: "400" },
    { path: "./fonts/ibm-plex-mono-500.woff2", weight: "500" },
    { path: "./fonts/ibm-plex-mono-600.woff2", weight: "600" },
  ],
  variable: "--font-mono",
  display: "swap",
});

// Las dos voces de allok (allok.fun): Geist para cada palabra, JetBrains Mono
// para etiquetas, horas y cifras. Se declaran siempre pero solo se descargan
// cuando algo las usa, y globals.css las engancha a --font-sans/--font-mono
// únicamente bajo [data-saas="true"]: la instancia Vocero sigue en Archivo +
// Plex Mono.
const geist = localFont({
  src: "./fonts/geist-100-900.woff2",
  weight: "100 900",
  variable: "--font-grotesk",
  display: "swap",
});
// Google sirve el mismo archivo variable para 400 y 500.
const jetbrainsMono = localFont({
  src: [
    { path: "./fonts/jetbrains-mono-400-500.woff2", weight: "400" },
    { path: "./fonts/jetbrains-mono-400-500.woff2", weight: "500" },
  ],
  variable: "--font-jetbrains",
  display: "swap",
});

// Las voces de Rei (BRAND=rei): Geist ya está arriba; Geist Mono es la mono
// del sistema (rei-motion.css, tailwind.config del fork original). La serif
// reutiliza la MISMA fuente Instrument Serif que ya se descarga para Vocero,
// bajo un nombre de variable propio — así `[data-brand="rei"]` puede
// reasignar `--font-serif` sin autorreferenciarse (ver globals.css).
// `preload: false` en las dos: solo las usa `[data-brand="rei"]`, y
// precargarlas en un build de allok bajaría dos fuentes que ese despliegue
// nunca pinta.
// Geist Mono (OFL, Vercel; latin subset de Google Fonts, variable 100-900).
const geistMono = localFont({
  src: "./fonts/geist-mono-100-900.woff2",
  weight: "100 900",
  variable: "--font-geist-mono",
  display: "swap",
  preload: false,
});
const reiSerif = localFont({
  src: [
    { path: "./fonts/instrument-serif-400.woff2", weight: "400", style: "normal" },
    { path: "./fonts/instrument-serif-400-italic.woff2", weight: "400", style: "italic" },
  ],
  variable: "--font-instrument-serif",
  display: "swap",
  preload: false,
});

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const saasMode = isAllokSaaSMode();
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const organizationId = saasMode
    ? await resolveOrganizationIdForHost(host) ?? (isLegacyAppHost(host) ? await resolveLegacyOrganizationId() : null)
    : null;
  const fallback = isAllokBrand()
    ? { ...SAAS_BRANDING, name: brand().name, accent: brand().defaultAccent }
    : DEFAULT_BRANDING;
  const branding = await Promise.resolve(saasMode
    ? organizationId ? getBranding(organizationId) : fallback
    : getBranding()
  ).catch(() => fallback);
  return {
    title: saasMode
      ? brand().id === "rei"
        ? `${branding.name}: tu WhatsApp responde aunque estés en una visita`
        : `${branding.name} — Tu WhatsApp responde aunque estés cerrado`
      : brand().id === "rei" ? `${branding.name}: CRM de WhatsApp` : `${branding.name} — CRM de WhatsApp`,
    description: saasMode
      ? `${brand().Name} atiende las preguntas de tus clientes cuando tu equipo no está disponible.`
      : "CRM de WhatsApp con agente de IA y Laboratorio de auto-evaluación",
    // El `?v=` cambia con la marca: los navegadores guardan el favicon con una
    // insistencia notable y, sin eso, el logo nuevo tarda días en aparecer.
    icons: { icon: faviconHref(branding) },
  };
}

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const saasMode = isAllokSaaSMode();
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const organizationId = saasMode
    ? await resolveOrganizationIdForHost(host) ?? (isLegacyAppHost(host) ? await resolveLegacyOrganizationId() : null)
    : null;
  const fallback = isAllokBrand()
    ? { ...SAAS_BRANDING, name: brand().name, accent: brand().defaultAccent }
    : DEFAULT_BRANDING;
  const branding = await Promise.resolve(saasMode
    ? organizationId ? getBranding(organizationId) : fallback
    : getBranding()
  ).catch(() => fallback);
  const theme = normalizeThemePreference(
    (await cookies()).get(THEME_COOKIE)?.value
  );
  const accent = branding.accent;
  return (
    <html
      lang="es"
      className={[
        archivo.variable,
        instrumentSerif.variable,
        plexMono.variable,
        geist.variable,
        jetbrainsMono.variable,
        geistMono.variable,
        reiSerif.variable,
      ].join(" ")}
      // La preferencia siempre es explícita: el tema viaja resuelto en el HTML
      // del servidor, así que no hay divergencia con el cliente ni parpadeo.
      data-theme={theme}
      // `data-saas` es el gancho del diseño de marca (allok o Rei) en
      // globals.css; lo lleva también la instancia dedicada (ver
      // `isAllokBrand`). `data-brand` dice CUÁL marca — solo allok se apoya
      // en `data-saas` a secas hoy, así que este atributo es nuevo y no
      // cambia nada de lo que ya existe.
      data-saas={isAllokBrand() ? "true" : undefined}
      data-brand={isAllokBrand() ? brand().id : undefined}
    >
      <head>
        {/* Acento white-label inyectado en SSR: sin flash de tema */}
        <style
          dangerouslySetInnerHTML={{ __html: accentCssVariables(accent, brand().id === "rei" ? "#142822" : undefined) }}
        />
      </head>
      <body className="font-sans">{children}</body>
    </html>
  );
}

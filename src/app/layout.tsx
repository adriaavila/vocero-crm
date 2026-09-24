import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import {
  Archivo,
  Geist,
  IBM_Plex_Mono,
  Instrument_Serif,
  JetBrains_Mono,
} from "next/font/google";
import { accentCssVariables, DEFAULT_BRANDING, SAAS_BRANDING } from "@/lib/branding";
import { faviconHref } from "@/lib/favicon";
import { normalizeThemePreference, THEME_COOKIE } from "@/lib/theme";
import { getBranding } from "@/server/branding";
import { isAllokBrand, isAllokSaaSMode, isLegacyAppHost } from "@/lib/tenant-host";
import { resolveLegacyOrganizationId, resolveOrganizationIdForHost } from "@/server/auth/on-signup";
import "./globals.css";

// Las tres voces de la marca, las mismas de vocerocrm.com. next/font las
// descarga en BUILD y las sirve self-hosted (sin CDN en runtime: soberanía).
const archivo = Archivo({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});
const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--font-serif",
  display: "swap",
});
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
  display: "swap",
});

// Las dos voces de allok (allok.fun): Geist para cada palabra, JetBrains Mono
// para etiquetas, horas y cifras. Se declaran siempre pero solo se descargan
// cuando algo las usa, y globals.css las engancha a --font-sans/--font-mono
// únicamente bajo [data-saas="true"]: la instancia Vocero sigue en Archivo +
// Plex Mono.
const geist = Geist({
  subsets: ["latin"],
  variable: "--font-grotesk",
  display: "swap",
});
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-jetbrains",
  display: "swap",
});

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const saasMode = isAllokSaaSMode();
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const organizationId = saasMode
    ? await resolveOrganizationIdForHost(host) ?? (isLegacyAppHost(host) ? await resolveLegacyOrganizationId() : null)
    : null;
  const fallback = isAllokBrand() ? SAAS_BRANDING : DEFAULT_BRANDING;
  const branding = await Promise.resolve(saasMode
    ? organizationId ? getBranding(organizationId) : fallback
    : getBranding()
  ).catch(() => fallback);
  return {
    title: saasMode
      ? `${branding.name} — Tu WhatsApp responde aunque estés cerrado`
      : `${branding.name} — CRM de WhatsApp`,
    description: saasMode
      ? "Allok atiende las preguntas de tus clientes cuando tu equipo no está disponible."
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
  const fallback = isAllokBrand() ? SAAS_BRANDING : DEFAULT_BRANDING;
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
      ].join(" ")}
      // La preferencia siempre es explícita: el tema viaja resuelto en el HTML
      // del servidor, así que no hay divergencia con el cliente ni parpadeo.
      data-theme={theme}
      // `data-saas` es el gancho del diseño allok en globals.css; lo lleva
      // también la instancia dedicada (ver `isAllokBrand`).
      data-saas={isAllokBrand() ? "true" : undefined}
    >
      <head>
        {/* Acento white-label inyectado en SSR: sin flash de tema */}
        <style
          dangerouslySetInnerHTML={{ __html: accentCssVariables(accent) }}
        />
      </head>
      <body className="font-sans">{children}</body>
    </html>
  );
}

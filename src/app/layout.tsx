import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import {
  Archivo,
  Archivo_Black,
  Geist,
  IBM_Plex_Mono,
  Instrument_Serif,
  JetBrains_Mono,
} from "next/font/google";
import { accentCssVariables, DEFAULT_BRANDING } from "@/lib/branding";
import { faviconHref } from "@/lib/favicon";
import { normalizeThemePreference, THEME_COOKIE } from "@/lib/theme";
import { getBranding } from "@/server/branding";
import { isAllokSaaSMode, isLegacyAppHost } from "@/lib/tenant-host";
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

// Las tres voces de Dawn → Dusk, para la superficie allok SaaS. Se declaran
// siempre pero solo se descargan cuando algo las usa, y globals.css las
// engancha a --font-sans/--font-mono/--font-serif únicamente bajo
// [data-saas="true"]: la instancia Vocero sigue en Archivo + Plex Mono.
const geist = Geist({
  subsets: ["latin"],
  variable: "--font-grotesk",
  display: "swap",
});
const archivoBlack = Archivo_Black({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-poster",
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
  const branding = await Promise.resolve(saasMode
    ? organizationId ? getBranding(organizationId) : DEFAULT_BRANDING
    : getBranding()
  ).catch(() => DEFAULT_BRANDING);
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
  const branding = await Promise.resolve(saasMode
    ? organizationId ? getBranding(organizationId) : DEFAULT_BRANDING
    : getBranding()
  ).catch(() => DEFAULT_BRANDING);
  const theme = normalizeThemePreference(
    (await cookies()).get(THEME_COOKIE)?.value
  );
  // Allok gets its own product surface; the legacy Vocero CRM keeps the
  // existing palette and white-label behavior untouched.
  const accent = saasMode && branding.accent === DEFAULT_BRANDING.accent
    ? "#147d52"
    : branding.accent;
  return (
    <html
      lang="es"
      className={[
        archivo.variable,
        instrumentSerif.variable,
        plexMono.variable,
        geist.variable,
        archivoBlack.variable,
        jetbrainsMono.variable,
      ].join(" ")}
      // La preferencia siempre es explícita: el tema viaja resuelto en el HTML
      // del servidor, así que no hay divergencia con el cliente ni parpadeo.
      data-theme={theme}
      data-saas={saasMode ? "true" : undefined}
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

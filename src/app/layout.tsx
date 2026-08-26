import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import { accentCssVariables, DEFAULT_BRANDING } from "@/lib/branding";
import { getBranding } from "@/server/branding";
import "./globals.css";

// next/font descarga la fuente en BUILD y la sirve self-hosted (sin CDN).
const geist = Geist({
  subsets: ["latin"],
  variable: "--font-geist",
  display: "swap",
});

export const dynamic = "force-dynamic";

// `viewportFit: cover` es lo que activa env(safe-area-inset-*) en iOS; sin él
// la barra inferior queda debajo del indicador de inicio al instalar la app.
export const viewport: Viewport = {
  themeColor: "#ffffff",
  viewportFit: "cover",
  width: "device-width",
  initialScale: 1,
};

export async function generateMetadata(): Promise<Metadata> {
  const branding = await getBranding().catch(() => DEFAULT_BRANDING);
  const title = `${branding.name} — CRM de WhatsApp`;
  const description = "Gestiona conversaciones, contactos y ventas por WhatsApp";
  return {
    metadataBase: new URL("https://crm.allok.fun"),
    title,
    description,
    openGraph: {
      title,
      description,
      url: "https://crm.allok.fun",
      siteName: branding.name,
      locale: "es_VE",
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
    // Instalable en el teléfono: pantalla completa, sin barra de URL.
    appleWebApp: { capable: true, title: branding.name, statusBarStyle: "default" },
    formatDetection: { telephone: false },
  };
}

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const branding = await getBranding().catch(() => DEFAULT_BRANDING);
  return (
    <html lang="es" className={geist.variable}>
      <head>
        {/* Acento white-label inyectado en SSR: sin flash de tema */}
        <style
          dangerouslySetInnerHTML={{ __html: accentCssVariables(branding.accent) }}
        />
      </head>
      <body className="font-sans">{children}</body>
    </html>
  );
}

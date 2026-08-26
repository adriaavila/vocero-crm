import type { MetadataRoute } from "next";
import { DEFAULT_BRANDING } from "@/lib/branding";
import { getBranding } from "@/server/branding";

// El manifiesto hereda el white-label de la organización: instalada en el
// teléfono, la app lleva el nombre y el acento del negocio, no "Vocero".
export const dynamic = "force-dynamic";

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const branding = await getBranding().catch(() => DEFAULT_BRANDING);
  return {
    name: `${branding.name} — CRM de WhatsApp`,
    short_name: branding.name,
    description: "Gestiona conversaciones, contactos y ventas por WhatsApp",
    lang: "es",
    dir: "ltr",
    start_url: "/overview",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Bandeja", url: "/inbox" },
      { name: "Pipeline", url: "/pipeline" },
    ],
  };
}

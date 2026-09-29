import type { MetadataRoute } from "next";
import { DEFAULT_BRANDING } from "@/lib/branding";
import { brand } from "@/lib/brand";
import { ALLOK_ICON_VERSION } from "@/lib/favicon";
import { getBranding } from "@/server/branding";
import { headers } from "next/headers";
import { isAllokSaaSMode, isLegacyAppHost } from "@/lib/tenant-host";
import { resolveLegacyOrganizationId, resolveOrganizationIdForHost } from "@/server/auth/on-signup";

// El manifiesto hereda el white-label de la organización: instalada en el
// teléfono, la app lleva el nombre y el acento del negocio, no "Vocero".
export const dynamic = "force-dynamic";

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const organizationId = isAllokSaaSMode()
    ? await resolveOrganizationIdForHost(host) ?? (isLegacyAppHost(host) ? await resolveLegacyOrganizationId() : null)
    : undefined;
  const branding = await (isAllokSaaSMode() && !organizationId
    // Nombre de la marca activa; el acento se queda como está (ver el mismo
    // comentario en opengraph-image.tsx) para no tocar el resultado de allok
    // en este respaldo de borde (host de alta sin organización resuelta).
    ? Promise.resolve({ ...DEFAULT_BRANDING, name: brand().name })
    : getBranding(organizationId)).catch(() => DEFAULT_BRANDING);
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
      // Next sirve icon.svg `immutable` por un año: el `?v=` cambia con el
      // símbolo, o Cloudflare y el teléfono se quedan con el anterior.
      { src: `/icon.svg?v=${ALLOK_ICON_VERSION}`, sizes: "any", type: "image/svg+xml" },
      { src: `/icon-512.png?v=${ALLOK_ICON_VERSION}`, sizes: "512x512", type: "image/png", purpose: "any" },
      { src: `/icon-maskable-512.png?v=${ALLOK_ICON_VERSION}`, sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Bandeja", url: "/inbox" },
      { name: "Pipeline", url: "/pipeline" },
    ],
  };
}

import { ImageResponse } from "next/og";
import { DEFAULT_BRANDING, resolveAccentSet } from "@/lib/branding";
import { faviconInitial } from "@/lib/favicon";
import { getBranding } from "@/server/branding";
import { headers } from "next/headers";
import { isAllokSaaSMode, isLegacyAppHost } from "@/lib/tenant-host";
import { resolveLegacyOrganizationId, resolveOrganizationIdForHost } from "@/server/auth/on-signup";

export const alt = "CRM de WhatsApp";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const organizationId = isAllokSaaSMode()
    ? await resolveOrganizationIdForHost(host) ?? (isLegacyAppHost(host) ? await resolveLegacyOrganizationId() : null)
    : undefined;
  const branding = await (isAllokSaaSMode() && !organizationId
    ? Promise.resolve(DEFAULT_BRANDING)
    : getBranding(organizationId)).catch(() => DEFAULT_BRANDING);
  const { accent, fg } = resolveAccentSet(branding.accent);

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        background: "#08090a",
        color: "#f5f5f4",
        padding: "68px 80px",
        fontFamily: "sans-serif",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div
          style={{
            display: "flex",
            width: 52,
            height: 52,
            borderRadius: 16,
            background: accent,
            color: fg,
            alignItems: "center",
            justifyContent: "center",
            fontSize: 26,
            fontWeight: 700,
          }}
        >
          {faviconInitial(branding.name)}
        </div>
        <span style={{ fontSize: 20, color: "#8a8a8a", letterSpacing: "0.12em" }}>CRM · WHATSAPP</span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <span style={{ fontSize: 92, fontWeight: 600, lineHeight: 1, letterSpacing: "-0.05em" }}>
          {branding.name}
        </span>
        <span style={{ fontSize: 30, color: "#a1a1a3" }}>
          Conversaciones, contactos y ventas en un solo lugar.
        </span>
      </div>
    </div>,
    size
  );
}

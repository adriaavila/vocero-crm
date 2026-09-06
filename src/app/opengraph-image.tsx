import { ImageResponse } from "next/og";
import { DEFAULT_BRANDING } from "@/lib/branding";
import { getBranding } from "@/server/branding";

export const alt = "Vocero — CRM de WhatsApp";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const WAVE = "M0 80 Q20 64 40 80 Q60 166 80 80 Q100 -52 120 80 Q140 212 160 80 Q180 -52 200 80 Q220 166 240 80 Q260 12 280 80 Q300 148 320 80 Q340 -52 360 80 Q380 212 400 80 Q420 -52 440 80 Q460 166 480 80 Q500 64 520 80 Q540 96 560 80 Q580 12 600 80 Q620 148 640 80 Q660 -52 680 80 Q700 212 720 80 Q740 -52 760 80 Q780 166 800 80 Q820 64 840 80 Q860 96 880 80 Q900 12 920 80 Q940 148 960 80 Q980 -52 1000 80 Q1020 166 1040 80";

export default async function Image() {
  const branding = await getBranding().catch(() => DEFAULT_BRANDING);

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
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <svg width="52" height="52" viewBox="0 0 64 64">
            <rect width="64" height="64" rx="16" fill="#151618" />
            <path d="M0 32 Q2.08 30.35 4.17 32 Q6.25 40.86 8.33 32 Q10.42 14.22 12.5 32 Q14.58 55.17 16.67 32 Q18.75 10.62 20.83 32 Q22.92 44.55 25 32 Q27.08 19.45 29.17 32 Q31.25 53.38 33.33 32 Q35.42 8.83 37.5 32 Q39.58 49.78 41.67 32 Q43.75 23.14 45.83 32 Q47.92 33.65 50 32" transform="translate(7,0)" fill="none" stroke="#c5f04a" strokeWidth="2.6" strokeLinecap="round" />
          </svg>
          <span style={{ fontSize: 30, fontWeight: 600, letterSpacing: "-0.03em" }}>Vocero</span>
        </div>
        <span style={{ fontSize: 20, color: "#8a8a8a", letterSpacing: "0.12em" }}>CRM · WHATSAPP</span>
      </div>

      <svg width="1040" height="160" viewBox="0 0 1040 160">
        <path d={WAVE} fill="none" stroke="#c5f04a" strokeWidth="3.4" strokeLinecap="round" />
      </svg>

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

import { withOwner } from "@/lib/api";
import { getEnv } from "@/lib/env";
import { isChannelEnabled } from "@/server/channels/enabled";
import { isAllokSaaSMode } from "@/lib/tenant-host";

export const dynamic = "force-dynamic";

/**
 * Datos del webhook para pegar en Meta o en el backend de la agencia (FR-043).
 *
 * Los canales opcionales comparten el segmento secreto y el verify token, pero
 * cada uno tiene su ruta: Meta configura el webhook de Messenger y el de
 * Instagram por separado (productos distintos de la misma app), así que aquí
 * viajan las tres URLs y la pantalla de cada canal enseña la suya. Las de un
 * canal apagado van en null: no existen en esta instancia (ADR-001).
 *
 * Fork — owner-only: el verify token es válido para TODA la instancia
 * (segmento secreto de la URL del webhook); un miembro sin ese rol no debe
 * poder leerlo.
 *
 * Fork — 404 en SaaS: el override de Embedded Signup mueve el webhook solo;
 * esta superficie manual no existe para un inquilino SaaS (igual que un
 * canal apagado, ADR-001: 404 y no 403, nada que revelar).
 */
export const GET = withOwner(async () => {
  if (isAllokSaaSMode()) return new Response(null, { status: 404 });
  const env = getEnv();
  const base = env.APP_BASE_URL.replace(/\/$/, "");
  const url = `${base}/api/webhooks/wa/${env.META_WEBHOOK_VERIFY_TOKEN}`;
  return Response.json({
    url,
    instagramUrl: isChannelEnabled("instagram")
      ? `${base}/api/webhooks/ig/${env.META_WEBHOOK_VERIFY_TOKEN}`
      : null,
    messengerUrl: isChannelEnabled("messenger")
      ? `${base}/api/webhooks/messenger/${env.META_WEBHOOK_VERIFY_TOKEN}`
      : null,
    verifyToken: env.META_WEBHOOK_VERIFY_TOKEN,
    isHttps: url.startsWith("https://"),
    signatureLayer: Boolean(env.META_APP_SECRET),
  });
});

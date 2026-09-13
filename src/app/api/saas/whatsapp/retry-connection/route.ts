import { apiError, withOwner } from "@/lib/api";
import { isAllokSaaSMode } from "@/lib/tenant-host";
import { canAutomate } from "@/server/agencia/entitlements";

export const dynamic = "force-dynamic";

/**
 * Rescata un alta que quedó a medias: el número sí se conectó en Meta, pero la
 * entrega a esta instancia falló y el negocio se quedó sin credenciales.
 *
 * Allok es quien tiene el token, así que aquí sólo se le pide que repita la
 * entrega. La URL sale de la del enlace de alta porque las dos rutas viven en
 * la misma app por construcción: una segunda variable sería una forma nueva de
 * apuntar a sitios distintos y no enterarse.
 */
export const POST = withOwner(async (session) => {
  if (!isAllokSaaSMode()) return apiError(404, "not_found", "SaaS no está habilitado");
  if (!(await canAutomate(session.organizationId))) {
    return apiError(402, "billing_inactive", "Activa tu plan para conectar un número de WhatsApp");
  }

  const linkUrl = process.env.ALLOK_SAAS_LINK_URL?.trim();
  const secret = process.env.ALLOK_SAAS_LINK_SECRET?.trim();
  if (!linkUrl || !secret) {
    return apiError(503, "not_configured", "La conexión guiada de WhatsApp todavía no está configurada");
  }

  let endpoint: string;
  try {
    endpoint = new URL("/api/meta/tenant-handover/retry", linkUrl).toString();
  } catch {
    return apiError(503, "not_configured", "La conexión guiada de WhatsApp está mal configurada");
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${secret}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ workspace: session.organizationId }),
    signal: AbortSignal.timeout(20_000),
  }).catch(() => null);

  const payload = (await response?.json().catch(() => null)) as
    { ok?: boolean; error?: string } | null;
  if (response?.status === 404) {
    return apiError(
      409,
      "no_connection",
      "Allok no ve ningún número conectado para este negocio. Conéctalo con Meta primero.",
    );
  }
  if (!response?.ok || payload?.ok !== true) {
    return apiError(502, "retry_failed", payload?.error ?? "Allok no pudo repetir la entrega");
  }
  return Response.json({ ok: true });
});

import { apiError, withOwner } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { isAllokSaaSMode } from "@/lib/tenant-host";
import { eq } from "drizzle-orm";
import { tenantOrigin } from "@/server/saas/billing";

export const dynamic = "force-dynamic";

export const POST = withOwner(async (session, request: Request) => {
  if (!isAllokSaaSMode()) return apiError(404, "not_found", "SaaS no está habilitado");

  const endpoint = process.env.ALLOK_SAAS_LINK_URL?.trim();
  const secret = process.env.ALLOK_SAAS_LINK_SECRET?.trim();
  if (!endpoint || !secret) {
    return apiError(503, "not_configured", "La conexión guiada de WhatsApp todavía no está configurada");
  }

  const organization = await getDb()
    .select({ slug: schema.organization.slug })
    .from(schema.organization)
    .where(eq(schema.organization.id, session.organizationId))
    .limit(1);
  const returnUrl = organization[0]?.slug
    ? `${tenantOrigin(organization[0].slug, request)}/settings/whatsapp`
    : undefined;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${secret}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ workspace: session.organizationId, mode: "coexistence", return_url: returnUrl }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);

  const payload = (await response?.json().catch(() => null)) as { url?: string; error?: string } | null;
  if (!response?.ok || !payload?.url) {
    return apiError(502, "onboarding_unavailable", payload?.error ?? "Allok no pudo preparar el enlace de Meta");
  }
  return Response.json({ url: payload.url, expiresInSeconds: 7 * 24 * 60 * 60 });
});

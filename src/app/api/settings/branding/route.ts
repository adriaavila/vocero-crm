import { z } from "zod";
import { parseBody, withOwner } from "@/lib/api";
import { getSessionOrNull } from "@/lib/auth/session";
import { DEFAULT_BRANDING, isValidHex, resolveAccentSet } from "@/lib/branding";
import { CURRENCIES } from "@/lib/money";
import { getBranding, saveBranding } from "@/server/branding";
import { isAllokSaaSMode, isKnownAllokHost, isLegacyAppHost, tenantSlugFromHost } from "@/lib/tenant-host";
import { resolveLegacyOrganizationId, resolveOrganizationIdForHost } from "@/server/auth/on-signup";

export const dynamic = "force-dynamic";

/** GET público: el login necesita la marca antes de autenticarse. */
export async function GET(req: Request) {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const saasMode = isAllokSaaSMode();
  const tenantSlug = tenantSlugFromHost(host);
  if (saasMode && !isKnownAllokHost(host)) return Response.json({ error: "not_found" }, { status: 404 });
  const hostOrganizationId = tenantSlug
    ? await resolveOrganizationIdForHost(host)
    : isLegacyAppHost(host)
      ? await resolveLegacyOrganizationId()
      : null;
  if (saasMode && tenantSlug && !hostOrganizationId) return Response.json({ error: "not_found" }, { status: 404 });
  if (saasMode && !tenantSlug && !isLegacyAppHost(host)) {
    return Response.json({ branding: DEFAULT_BRANDING, accentSet: resolveAccentSet(DEFAULT_BRANDING.accent) });
  }
  const session = await getSessionOrNull();
  const branding = await getBranding(hostOrganizationId ?? session?.organizationId);
  return Response.json({ branding, accentSet: resolveAccentSet(branding.accent) });
}

const putSchema = z.object({
  name: z.string().trim().min(1).max(30),
  accent: z.string().refine(isValidHex, "Color hex inválido (#rrggbb)"),
  /** La moneda del negocio: la única que el tablero suma. */
  currency: z.enum(CURRENCIES),
});

export const PUT = withOwner(async (session, req: Request) => {
  const body = await parseBody(req, putSchema);
  if (!body.ok) return body.response;
  // El icono se conserva: este formulario es de nombre, color y moneda, y se
  // sube y se quita por su propia ruta. Sin esto, guardar el nombre borraría
  // el logo sin que nadie lo pidiera.
  const actual = await getBranding(session.organizationId);
  await saveBranding(session.organizationId, {
    ...body.data,
    favicon: actual.favicon,
  });
  return Response.json({ ok: true });
});

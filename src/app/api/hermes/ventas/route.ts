import { z } from "zod";
import { apiError } from "@/lib/api";
import { resolveInstanceOrg } from "@/server/bot/auth";
import { requireHermesKey } from "@/server/agencia/hermes-auth";
import { HERMES_PERIODOS, reporteVentas, resolverNegocio } from "@/server/agencia/hermes-ventas";

export const dynamic = "force-dynamic";

const Query = z.object({
  negocio: z.string().trim().min(1).max(120).optional(),
  periodo: z.enum(HERMES_PERIODOS).default("7d"),
  formato: z.enum(["whatsapp", "telegram"]).default("whatsapp"),
});

/**
 * Fork — reporte de ventas para Hermes.
 * GET /api/hermes/ventas?negocio=samer&periodo=7d&formato=telegram
 * Sin `negocio`, el de la instancia (o el de `X-Organization-Id` en el SaaS).
 * Header `X-API-Key: $HERMES_API_KEY`.
 * → { texto, sugerencias, datos }: `texto` se manda tal cual al celular;
 * `datos` es lo que Hermes lee para contestar una pregunta libre.
 * Solo lectura; no gasta IA del negocio.
 */
export async function GET(req: Request) {
  const denied = requireHermesKey(req);
  if (denied) return denied;

  const url = new URL(req.url);
  const q = Query.safeParse(Object.fromEntries(url.searchParams));
  if (!q.success) return apiError(400, "invalid_query", "Un parámetro no es válido");

  const organizationId = q.data.negocio ? await resolverNegocio(q.data.negocio) : await resolveInstanceOrg(req);
  if (!organizationId) return apiError(404, "no_org", "No encuentro ese negocio");

  const reporte = await reporteVentas(organizationId, { periodo: q.data.periodo, formato: q.data.formato });
  return Response.json(reporte, { headers: { "Cache-Control": "no-store" } });
}

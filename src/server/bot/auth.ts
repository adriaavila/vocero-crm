import { timingSafeEqual } from "node:crypto";
import { getDb, schema } from "@/lib/db";
import { apiError } from "@/lib/api";
import { checkRateLimit } from "@/lib/rate-limit";
import { isAllokSaaSMode } from "@/lib/tenant-host";
import { resolveOrganizationIdForHost } from "@/server/auth/on-signup";

/**
 * Autenticación de la API de servicio `/api/bot/*`.
 *
 * Esta superficie NO la consume el navegador: la consume un cerebro externo
 * (un microservicio propio del operador, en su mismo servidor) que quiere
 * conducir la conversación sin que el token de WhatsApp salga del CRM.
 * Header `X-API-Key` contra `BOT_API_KEY` (env), comparación en tiempo
 * constante. Sin `BOT_API_KEY` configurada, toda la superficie responde 401.
 */

export function requireBotKey(req: Request): Response | null {
  const rl = checkRateLimit("bot-api", { windowMs: 60_000, max: 600 });
  if (!rl.allowed) return apiError(429, "rate_limited", "Demasiadas solicitudes");

  const expected = process.env.BOT_API_KEY;
  const provided = req.headers.get("x-api-key");
  if (!expected || expected.length < 16 || !provided) {
    return apiError(401, "unauthorized", "No autorizado");
  }
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return apiError(401, "unauthorized", "No autorizado");
  }
  return null;
}

/**
 * En SaaS, el host es la frontera del tenant. Legacy conserva la resolución
 * cacheada de la instancia única para no cambiar el contrato existente.
 */
let cachedOrgId: string | null = null;

export async function resolveInstanceOrg(req?: Request): Promise<string | null> {
  if (isAllokSaaSMode()) {
    if (!req) return null;
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    return resolveOrganizationIdForHost(host);
  }
  if (cachedOrgId) return cachedOrgId;
  const db = getDb();
  const rows = await db
    .select({ id: schema.organization.id })
    .from(schema.organization)
    .limit(1);
  cachedOrgId = rows[0]?.id ?? null;
  return cachedOrgId;
}

/** Solo para tests. */
export function resetInstanceOrgCache(): void {
  cachedOrgId = null;
}

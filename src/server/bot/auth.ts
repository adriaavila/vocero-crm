import { timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
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
  // ponytail: un solo bucket para TODA la superficie /api/bot/*, compartido
  // por todas las organizaciones — correcto cuando el cerebro externo era una
  // instancia por negocio, pero Nea es un servicio único para todo el SaaS:
  // 600/min lo asfixiaba con pocos tenants activos a la vez. Si algún día un
  // cerebro externo abusa, la solución es un bucket POR ORGANIZACIÓN, no bajar
  // este número otra vez.
  const rl = checkRateLimit("bot-api", { windowMs: 60_000, max: 3000 });
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
 *
 * Nea despacha por HTTP directo al servicio (no por Host), así que en SaaS
 * manda su propia organización en `X-Organization-Id`; el Host sigue de
 * respaldo para cerebros externos que aún no lo mandan.
 */
let cachedOrgId: string | null = null;

export async function resolveInstanceOrg(req?: Request): Promise<string | null> {
  if (isAllokSaaSMode()) {
    if (!req) return null;
    const headerOrgId = req.headers.get("x-organization-id")?.trim();
    if (headerOrgId) {
      // ponytail: la clave de plataforma puede dirigirse a cualquier
      // organización (igual que el Host hoy); si Nea deja de ser propiedad de
      // la plataforma, cambiar a una clave derivada por org:
      // HMAC(BOT_API_KEY, orgId).
      const db = getDb();
      const rows = await db
        .select({ id: schema.organization.id })
        .from(schema.organization)
        .where(eq(schema.organization.id, headerOrgId))
        .limit(1);
      return rows[0]?.id ?? null;
    }
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

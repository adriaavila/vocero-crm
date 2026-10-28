import { timingSafeEqual } from "node:crypto";
import { apiError } from "@/lib/api";
import { checkRateLimit } from "@/lib/rate-limit";

/**
 * Fork — la llave de Hermes, el agente personal del operador (allok-brain,
 * `agents/hermes`), para LEER el reporte de ventas de cualquier negocio de
 * esta instancia.
 *
 * Es una llave aparte de `BOT_API_KEY` a propósito: aquella deja conducir
 * conversaciones (y su sola presencia cambia cómo nace `ai_enabled`, ver
 * `ia-inicial.ts`); esta solo deja leer cifras. Sin `HERMES_API_KEY` la
 * superficie no existe: 404, como un módulo apagado.
 */
export function requireHermesKey(req: Request): Response | null {
  const expected = process.env.HERMES_API_KEY;
  if (!expected || expected.length < 16) return apiError(404, "not_found", "No encontrado");

  const rl = checkRateLimit("hermes-api", { windowMs: 60_000, max: 60 });
  if (!rl.allowed) return apiError(429, "rate_limited", "Demasiadas solicitudes");

  const provided = req.headers.get("x-api-key");
  if (!provided) return apiError(401, "unauthorized", "No autorizado");
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return apiError(401, "unauthorized", "No autorizado");
  }
  return null;
}

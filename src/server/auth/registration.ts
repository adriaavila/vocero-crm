import { count } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { isAllokSaaSMode } from "@/lib/tenant-host";

/**
 * Alta de autoservicio en el SaaS. Apagada (decisión de Adrian, 2026-09-24:
 * "all in en sistemas a medida"), igual que `SELF_SERVE` en allok.fun: cada
 * negocio entra por una conversación y la puesta en marcha la hace allok. Con
 * esto en `false`, sólo un admin de allok (`ALLOK_ADMIN_EMAILS`) con sesión
 * abierta puede crear un negocio desde /register. `true` reabre el registro.
 */
export const SAAS_SELF_SERVE = false;

/**
 * Registro público cerrado tras la primera organización (FR-060), salvo la
 * variable de escape ALLOW_SIGNUP=true. Las cuentas de equipo las crea el
 * propietario (bypass interno del gate).
 */
export async function isPublicSignupAllowed(): Promise<boolean> {
  if (isAllokSaaSMode()) return SAAS_SELF_SERVE;
  if (process.env.ALLOW_SIGNUP === "true") return true;
  const db = getDb();
  const rows = await db.select({ n: count() }).from(schema.organization);
  return (rows[0]?.n ?? 0) === 0;
}

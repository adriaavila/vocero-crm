import { count } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { isAllokSaaSMode } from "@/lib/tenant-host";

/**
 * Alta de autoservicio en el SaaS: `SAAS_SELF_SERVE=true` abre /register a
 * cualquiera (registro → conectar WhatsApp → primer mensaje, sin allok de por
 * medio; decisión de Adrian, 2026-09-30). Apagada por defecto: sólo un admin
 * de allok (`ALLOK_ADMIN_EMAILS`) con sesión abierta crea negocios.
 */
export function isSaaSSelfServe(): boolean {
  return process.env.SAAS_SELF_SERVE === "true";
}

/**
 * Registro público cerrado tras la primera organización (FR-060), salvo la
 * variable de escape ALLOW_SIGNUP=true. Las cuentas de equipo las crea el
 * propietario (bypass interno del gate).
 */
export async function isPublicSignupAllowed(): Promise<boolean> {
  if (isAllokSaaSMode()) return isSaaSSelfServe();
  if (process.env.ALLOW_SIGNUP === "true") return true;
  const db = getDb();
  const rows = await db.select({ n: count() }).from(schema.organization);
  return (rows[0]?.n ?? 0) === 0;
}

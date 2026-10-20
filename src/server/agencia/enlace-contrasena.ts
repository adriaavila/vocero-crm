import { randomBytes } from "node:crypto";
import { and, asc, eq, like } from "drizzle-orm";
import { getAuth } from "@/lib/auth";
import { getDb, schema } from "@/lib/db";
import { isSaaSAdminEmail } from "@/lib/tenant-host";
import { RESET_TOKEN_TTL_SECONDS } from "./restablecer-contrasena";
import { tenantBaseUrl } from "./trial-correos";

/**
 * Capa de agencia — soporte sin correo: el admin del SaaS crea, para un
 * usuario de un negocio, el mismo enlace de un solo uso que manda «olvidé mi
 * contraseña», y se lo pasa al cliente por WhatsApp. Sirve con el conector de
 * correo apagado y cuando el correo no llega.
 *
 * El token es la misma fila `reset-password:<token>` que Better Auth crea y
 * consume en `/api/auth/reset-password`: vence en una hora, se borra al
 * usarse, y quien lo usa elige la contraseña (el admin nunca la ve ni la
 * pone). Crear uno nuevo invalida los anteriores de ese usuario, así un
 * enlace viejo reenviado por error ya no sirve.
 *
 * Quién puede llamarlo lo decide la ruta (`requireSaaSAdminIdentity`); aquí
 * solo se garantiza que el usuario sea miembro de ESE negocio.
 */

export type EnlaceContrasena = { url: string; email: string; expiresAt: string };

export class EnlaceContrasenaError extends Error {
  constructor(readonly code: "negocio_no_encontrado" | "usuario_no_encontrado" | "usuario_admin") {
    super(code);
  }
}

const PREFIX = "reset-password:";

export async function crearEnlaceContrasena(input: {
  organizationId: string;
  /** Un miembro del negocio; sin él, el dueño (el primero en entrar). */
  email?: string | null;
  now?: Date;
}): Promise<EnlaceContrasena & { userId: string }> {
  const db = getDb();
  const [org] = await db
    .select({ slug: schema.organization.slug })
    .from(schema.organization)
    .where(eq(schema.organization.id, input.organizationId))
    .limit(1);
  if (!org?.slug) throw new EnlaceContrasenaError("negocio_no_encontrado");

  const email = input.email?.trim().toLowerCase() || null;
  const members = await db
    .select({ userId: schema.member.userId, role: schema.member.role, email: schema.user.email })
    .from(schema.member)
    .innerJoin(schema.user, eq(schema.user.id, schema.member.userId))
    .where(eq(schema.member.organizationId, input.organizationId))
    .orderBy(asc(schema.member.createdAt));
  const target = email
    ? members.find((m) => m.email.toLowerCase() === email)
    : (members.find((m) => m.role === "owner") ?? members[0]);
  if (!target) throw new EnlaceContrasenaError("usuario_no_encontrado");
  // Un admin no le cambia la cuenta a otro admin: sería quedarse con su acceso al panel.
  if (isSaaSAdminEmail(target.email)) throw new EnlaceContrasenaError("usuario_admin");

  // Uno vivo por usuario: los enlaces anteriores (de este panel o del correo) dejan de servir.
  // Supone identificadores en claro (sin `verification.storeIdentifier` en lib/auth): con
  // hash, este borrado dejaría de alcanzar a los viejos aunque el nuevo funcione igual.
  await db
    .delete(schema.verification)
    .where(and(like(schema.verification.identifier, `${PREFIX}%`), eq(schema.verification.value, target.userId)));

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date((input.now ?? new Date()).getTime() + RESET_TOKEN_TTL_SECONDS * 1000);
  // Por el adaptador de Better Auth: guarda el identificador como él lo busca al consumirlo.
  const ctx = await getAuth().$context;
  await ctx.internalAdapter.createVerificationValue({
    identifier: `${PREFIX}${token}`,
    value: target.userId,
    expiresAt,
  });

  return {
    url: `${tenantBaseUrl(org.slug)}/reset-password?token=${token}`,
    email: target.email,
    expiresAt: expiresAt.toISOString(),
    userId: target.userId,
  };
}

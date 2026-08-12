import { randomInt } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { hashPassword } from "better-auth/crypto";
import { apiError, withOwner } from "@/lib/api";
import { getDb, schema } from "@/lib/db";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ memberId: string }> };

const ALPHABET = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function temporaryPassword(): string {
  return Array.from({ length: 16 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
}

export const POST = withOwner(async (session, _req: Request, ctx: Params) => {
  const { memberId } = await ctx.params;
  const db = getDb();
  const [target] = await db
    .select({ userId: schema.member.userId, role: schema.member.role, email: schema.user.email })
    .from(schema.member)
    .innerJoin(schema.user, eq(schema.user.id, schema.member.userId))
    .where(and(
      eq(schema.member.id, memberId),
      eq(schema.member.organizationId, session.organizationId)
    ))
    .limit(1);
  if (!target) return apiError(404, "not_found", "Miembro no encontrado");
  if (target.role === "owner") {
    return apiError(422, "owner_reset", "El propietario debe cambiar su propia contraseña");
  }

  const password = temporaryPassword();
  const passwordHash = await hashPassword(password);
  const updated = await db.transaction(async (tx) => {
    const accounts = await tx
      .update(schema.account)
      .set({ password: passwordHash, updatedAt: new Date() })
      .where(and(eq(schema.account.userId, target.userId), eq(schema.account.providerId, "credential")))
      .returning({ id: schema.account.id });
    if (accounts[0]) await tx.delete(schema.session).where(eq(schema.session.userId, target.userId));
    return accounts[0];
  });
  if (!updated) return apiError(409, "no_password", "La cuenta no usa contraseña");
  return Response.json(
    { email: target.email, temporaryPassword: password },
    { headers: { "Cache-Control": "no-store" } }
  );
});

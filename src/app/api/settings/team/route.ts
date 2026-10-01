import { count, eq } from "drizzle-orm";
import { z } from "zod";
import { apiError, parseBody, withProOwner } from "@/lib/api";
import { getAuth, runInternalSignup } from "@/lib/auth";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { PLAN_CATALOG } from "@/lib/saas-plans";
import { isAllokSaaSMode } from "@/lib/tenant-host";
import { getOrganizationBilling } from "@/server/saas/billing";

export const dynamic = "force-dynamic";

const DEFAULT_SEAT_LIMIT = 3;

/** Cupo de usuarios del plan vigente. Fuera de modo SaaS (o sin plan) se mantiene el 3 de siempre. */
async function seatLimitFor(organizationId: string): Promise<number> {
  if (!isAllokSaaSMode()) return DEFAULT_SEAT_LIMIT;
  const billing = await getOrganizationBilling(organizationId);
  return billing.plan ? PLAN_CATALOG[billing.plan].seats : DEFAULT_SEAT_LIMIT;
}

export const GET = withProOwner(async (session) => {
  const db = getDb();
  const [members, seatLimit] = await Promise.all([
    db
      .select({
        id: schema.member.id,
        role: schema.member.role,
        createdAt: schema.member.createdAt,
        name: schema.user.name,
        email: schema.user.email,
      })
      .from(schema.member)
      .innerJoin(schema.user, eq(schema.member.userId, schema.user.id))
      .where(scoped(schema.member.organizationId, session.organizationId)),
    seatLimitFor(session.organizationId),
  ]);
  return Response.json({
    members: members.map((m) => ({
      id: m.id,
      role: m.role,
      name: m.name,
      email: m.email,
      createdAt: m.createdAt.toISOString(),
    })),
    seatLimit,
  });
});

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email(),
  password: z.string().min(8).max(128),
});

/** Alta de cuenta de equipo (owner only): email + contraseña temporal (FR-061). */
export const POST = withProOwner(async (session, req: Request) => {
  const body = await parseBody(req, createSchema);
  if (!body.ok) return body.response;

  const [memberCount, seatLimit] = await Promise.all([
    getDb()
      .select({ count: count() })
      .from(schema.member)
      .where(scoped(schema.member.organizationId, session.organizationId)),
    seatLimitFor(session.organizationId),
  ]);
  if ((memberCount[0]?.count ?? 0) >= seatLimit) {
    return apiError(409, "member_limit", `Tu plan incluye hasta ${seatLimit} usuarios, incluido el propietario`);
  }

  const auth = getAuth();
  let newUserId: string;
  try {
    const result = await runInternalSignup(() =>
      auth.api.signUpEmail({
        body: {
          name: body.data.name,
          email: body.data.email,
          password: body.data.password,
        },
      })
    );
    newUserId = result.user.id;
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "No se pudo crear la cuenta";
    if (/exist/i.test(message)) {
      return apiError(409, "duplicate", "Ya existe una cuenta con ese correo");
    }
    return apiError(422, "invalid", message);
  }

  const db = getDb();
  await db
    .insert(schema.member)
    .values({
      id: newId("member"),
      organizationId: session.organizationId,
      userId: newUserId,
      role: "member",
    })
    .onConflictDoNothing();

  return Response.json({ ok: true }, { status: 201 });
});

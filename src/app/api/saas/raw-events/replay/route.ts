import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/lib/db";
import { replayRawEvents } from "@/server/agencia/raw-events";
import {
  auditSaaSAdminAction,
  requireSaaSAdminIdentity,
  SaaSAdminUnauthorized,
} from "@/server/saas/admin";

export const dynamic = "force-dynamic";

// `pending` solo sirve para rescatar lo que dejó un proceso caído a medias.
const bodySchema = z
  .object({
    organizationId: z.string().min(1).max(100).optional(),
    statuses: z
      .array(z.enum(["failed", "unrouted", "unmatched", "pending"]))
      .min(1)
      .max(4)
      .optional(),
    since: z.string().datetime().optional(),
    limit: z.number().int().min(1).max(2000).optional(),
  })
  .strict();

/**
 * Data spine — repite eventos del webhook que no terminaron bien: los que
 * fallaron, los de un número aún sin conectar y los estados que llegaron antes
 * que su mensaje. Solo el admin SaaS (host admin + email autorizado); queda en
 * `saas_admin_audit` con lo pedido y el resultado, nunca con contenido.
 */
export async function POST(req: Request): Promise<Response> {
  let admin;
  try {
    admin = await requireSaaSAdminIdentity();
  } catch (error) {
    if (error instanceof SaaSAdminUnauthorized) {
      return Response.json({ message: "No encontrado" }, { status: 404 });
    }
    throw error;
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ message: "Solicitud inválida." }, { status: 422 });
  const { organizationId, statuses, since, limit } = parsed.data;

  if (organizationId) {
    const found = await getDb()
      .select({ id: schema.organization.id })
      .from(schema.organization)
      .where(eq(schema.organization.id, organizationId))
      .limit(1);
    if (!found[0]) return Response.json({ message: "Negocio no encontrado." }, { status: 404 });
  }

  const summary = await replayRawEvents({
    organizationId,
    statuses,
    since: since ? new Date(since) : undefined,
    limit,
  });
  await auditSaaSAdminAction({
    userId: admin.userId,
    action: "replay_raw_events",
    organizationId: organizationId ?? null,
    detail: { statuses: statuses ?? null, since: since ?? null, limit: limit ?? null, ...summary },
  });
  return Response.json(summary);
}

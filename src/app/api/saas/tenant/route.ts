import { eq } from "drizzle-orm";
import { withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { isAllokSaaSMode } from "@/lib/tenant-host";
import { tenantOrigin } from "@/server/saas/billing";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (session, request: Request) => {
  if (!isAllokSaaSMode()) return Response.json({ url: null });
  const rows = await getDb()
    .select({ slug: schema.organization.slug })
    .from(schema.organization)
    .where(eq(schema.organization.id, session.organizationId))
    .limit(1);
  return Response.json({ url: rows[0]?.slug ? tenantOrigin(rows[0].slug, request) : null });
}, { allowSaaSAppHost: true });

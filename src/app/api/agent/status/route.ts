import { withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { isAgentConfigured } from "@/lib/env";

export const dynamic = "force-dynamic";

/** Estado mínimo que necesita la bandeja; no expone prompts ni conocimiento. */
export const GET = withAuth(async (session) => {
  const [profile] = await getDb()
    .select({ enabled: schema.agentProfile.enabled })
    .from(schema.agentProfile)
    .where(scoped(schema.agentProfile.organizationId, session.organizationId))
    .limit(1);
  return Response.json({
    enabled: Boolean(profile?.enabled),
    aiConfigured: isAgentConfigured(),
  });
});

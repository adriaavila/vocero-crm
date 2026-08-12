import { apiError, parseBody, withOwner } from "@/lib/api";
import { agentProfilePutSchema, compatibleActivation } from "@/lib/agent-profile-compat";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { isAgentConfigured } from "@/lib/env";

export const dynamic = "force-dynamic";

export const GET = withOwner(async (session) => {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.agentProfile)
    .where(scoped(schema.agentProfile.organizationId, session.organizationId))
    .limit(1);
  const p = rows[0];
  if (!p) return apiError(404, "not_found", "Perfil del agente no encontrado");
  const activation = compatibleActivation(p.activationMessages);
  return Response.json({
    profile: {
      enabled: p.enabled,
      name: p.name,
      tone: p.tone,
      instructions: p.instructions,
      escalationRules: p.escalationRules,
      greeting: p.greeting,
      activationEnabled: p.activationEnabled,
      activationMessages: activation.activationMessages,
      allowlistEnabled: p.allowlistEnabled,
      allowedWaIds: p.allowedWaIds,
      // Compatibility for tabs that loaded the previous deployment.
      presetOnly: p.activationEnabled,
      presetReplies: activation.presetReplies,
    },
    aiConfigured: isAgentConfigured(),
  });
});

export const PUT = withOwner(async (session, req: Request) => {
  const body = await parseBody(req, agentProfilePutSchema);
  if (!body.ok) return body.response;

  const db = getDb();
  const updated = await db
    .update(schema.agentProfile)
    .set({ ...body.data, updatedAt: new Date() })
    .where(scoped(schema.agentProfile.organizationId, session.organizationId))
    .returning();
  if (!updated[0]) return apiError(404, "not_found", "Perfil no encontrado");
  return Response.json({ ok: true });
});

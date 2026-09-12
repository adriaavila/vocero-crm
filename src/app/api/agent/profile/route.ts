import { apiError, parseBody, withOwner } from "@/lib/api";
import { agentProfilePutSchema, compatibleActivation } from "@/lib/agent-profile-compat";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { isAgentConfigured } from "@/lib/env";
import { isAllokSaaSMode } from "@/lib/tenant-host";
import { encenderConversacionesEnEspera } from "@/server/agencia/ia-inicial";
import { canAutomate, hasSaaSPlan } from "@/server/agencia/entitlements";
import { getBusinessHours, hasConfiguredBusinessHours } from "@/server/business-hours";
import { getReadiness, saasActivationBlockers } from "@/server/readiness";
import { getCredentialsByOrg } from "@/server/whatsapp/credentials";

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
      aiProvider: p.aiProvider,
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
  if (body.data.enabled === true && !(await canAutomate(session.organizationId))) {
    return apiError(402, "billing_inactive", "Activa o recupera tu suscripción para encender Allok.");
  }
  if (body.data.enabled === true && isAllokSaaSMode()) {
    if (!isAgentConfigured()) {
      return apiError(503, "ai_not_configured", "La IA todavía no está configurada en esta instancia.");
    }
    const credentials = await getCredentialsByOrg(session.organizationId);
    if (!credentials || credentials.status !== "connected") {
      return apiError(409, "whatsapp_required", "Conecta y verifica tu número de WhatsApp antes de activar Allok.");
    }
    const businessHours = await getBusinessHours(session.organizationId);
    if (businessHours.responseMode === "all_day" && !(await hasSaaSPlan(session.organizationId, "pro"))) {
      return apiError(402, "pro_required", "La atención todo el día está disponible en Pro.");
    }
    if (!hasConfiguredBusinessHours(businessHours)) {
      return apiError(409, "business_hours_required", "Define al menos un horario de respuesta antes de activar Allok.");
    }
    const pending = saasActivationBlockers(await getReadiness(session.organizationId))
      .filter((step) => step.id !== "whatsapp" && step.id !== "business_hours");
    if (pending.length) {
      return apiError(
        409,
        "onboarding_incomplete",
        `Completa antes de activar: ${pending.map((step) => step.label).join(", ")}.`,
      );
    }
  }

  const db = getDb();
  const updated = await db
    .update(schema.agentProfile)
    .set({ ...body.data, updatedAt: new Date() })
    .where(scoped(schema.agentProfile.organizationId, session.organizationId))
    .returning();
  if (!updated[0]) return apiError(404, "not_found", "Perfil no encontrado");

  // Capa de agencia: encender el agente también despierta las conversaciones
  // que nacieron mientras estaba apagado. Sin esto, el dueño enciende el
  // interruptor, ve "Encendido", y sus leads de esta mañana siguen sin
  // respuesta — con todo aparentando estar bien.
  let despertadas = 0;
  if (
    body.data.enabled === true &&
    updated[0].enabled &&
    !updated[0].activationEnabled
  ) {
    despertadas = await encenderConversacionesEnEspera(
      session.organizationId
    ).catch(() => 0);
  }
  return Response.json({ ok: true, conversacionesDespertadas: despertadas });
});

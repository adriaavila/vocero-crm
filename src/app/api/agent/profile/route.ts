import { apiError, parseBody, withOwner } from "@/lib/api";
import { agentProfilePutSchema, compatibleActivation } from "@/lib/agent-profile-compat";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { isAllokSaaSMode } from "@/lib/tenant-host";
import { activationBlockers, activationError } from "@/server/agencia/activacion";
import { profileContentChanged } from "@/server/agencia/contenido-perfil";
import { encenderConversacionesEnEspera } from "@/server/agencia/ia-inicial";
import { isAgentAvailableForOrganization } from "@/server/ai/credentials";

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
    aiConfigured: await isAgentAvailableForOrganization(session.organizationId),
  });
});

export const PUT = withOwner(async (session, req: Request) => {
  const body = await parseBody(req, agentProfilePutSchema);
  if (!body.ok) return body.response;

  const db = getDb();
  const [stored] = await db
    .select()
    .from(schema.agentProfile)
    .where(scoped(schema.agentProfile.organizationId, session.organizationId))
    .limit(1);
  if (!stored) return apiError(404, "not_found", "Perfil no encontrado");

  const contentChanged = profileContentChanged(stored, body.data);
  // Solo es una ACTIVACIÓN si el agente estaba apagado: reenviar `enabled: true`
  // con el agente ya encendido (una pantalla que guarda el perfil completo) no
  // vuelve a exigir lo de la puesta en marcha, ni la prueba, para guardar un
  // cambio cualquiera.
  const activating = body.data.enabled === true && !stored.enabled;
  if (activating) {
    // El primer bloqueo manda: mismo orden, códigos y mensajes de siempre. La
    // pantalla «Activar» pinta esta misma lista (`server/agencia/activacion.ts`).
    const error = activationError(await activationBlockers(session.organizationId));
    if (error) return apiError(error.status, error.code, error.message);
    // Los bloqueos se calculan sobre lo guardado: si en la misma petición
    // cambia lo que el agente dice, esa edición aún no pasó por la prueba.
    if (isAllokSaaSMode() && contentChanged) {
      return apiError(
        409,
        "content_changed",
        "Guarda los cambios y vuelve a probar tu agente antes de activarlo.",
      );
    }
  }

  const updated = await db
    .update(schema.agentProfile)
    .set({ ...body.data, ...(contentChanged ? { updatedAt: new Date() } : {}) })
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

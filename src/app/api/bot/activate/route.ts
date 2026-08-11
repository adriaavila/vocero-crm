import { z } from "zod";
import { apiError, parseBody } from "@/lib/api";
import { requireBotKey, resolveInstanceOrg } from "@/server/bot/auth";
import { publish } from "@/server/events/bus";
import { updateConversation } from "@/server/inbox/queries";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ conversationId: z.string().min(1) });

export async function POST(req: Request) {
  const denied = requireBotKey(req);
  if (denied) return denied;
  const organizationId = await resolveInstanceOrg();
  if (!organizationId) return apiError(409, "no_org", "La instancia aún no tiene organización");

  const body = await parseBody(req, bodySchema);
  if (!body.ok) return body.response;
  const conversation = await updateConversation(organizationId, body.data.conversationId, {
    reactivate: true,
  });
  if (!conversation) return apiError(404, "not_found", "Conversación no encontrada");

  publish(organizationId, {
    type: "conversation.updated",
    data: { conversation: { id: conversation.id } },
  });
  return Response.json({ ok: true });
}

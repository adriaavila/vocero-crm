import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { apiError, parseBody } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { requireBotKey, resolveInstanceOrg } from "@/server/bot/auth";
import { SendError, sendText } from "@/server/inbox/send";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  conversationId: z.string().min(1),
  text: z.string().trim().min(1).max(4096),
});

export async function POST(req: Request) {
  const denied = requireBotKey(req);
  if (denied) return denied;
  const organizationId = await resolveInstanceOrg();
  if (!organizationId) return apiError(409, "no_org", "La instancia aún no tiene organización");
  const body = await parseBody(req, bodySchema);
  if (!body.ok) return body.response;

  const rows = await getDb()
    .select({
      id: schema.conversation.id,
      aiEnabled: schema.conversation.aiEnabled,
      handoffAt: schema.conversation.handoffAt,
    })
    .from(schema.conversation)
    .where(
      and(
        eq(schema.conversation.organizationId, organizationId),
        eq(schema.conversation.id, body.data.conversationId)
      )
    )
    .limit(1);
  const conversation = rows[0];
  if (!conversation) return apiError(404, "not_found", "Conversación no encontrada");
  if (!conversation.aiEnabled || conversation.handoffAt) {
    return Response.json({ code: "ai_paused" }, { status: 409 });
  }

  try {
    const sent = await sendText({
      organizationId,
      conversationId: conversation.id,
      text: body.data.text,
      aiGenerated: true,
    });
    return Response.json({ messageId: sent.messageId });
  } catch (error) {
    if (error instanceof SendError && error.code === "window_closed") {
      return Response.json({ code: "window_closed" }, { status: 409 });
    }
    if (error instanceof SendError) {
      const status = error.code === "meta_unavailable" ? 503 : 422;
      return apiError(status, error.code, error.message);
    }
    throw error;
  }
}

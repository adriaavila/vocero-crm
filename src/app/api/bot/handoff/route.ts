import { z } from "zod";
import { apiError, parseBody } from "@/lib/api";
import { requireBotKey, resolveInstanceOrg } from "@/server/bot/auth";
import { handoffConversation } from "@/server/bot/gateway";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  conversationId: z.string().min(1),
  reason: z.enum(["cliente", "modelo", "error", "ventana", "hostilidad"]),
});

export async function POST(req: Request) {
  const denied = requireBotKey(req);
  if (denied) return denied;
  const organizationId = await resolveInstanceOrg();
  if (!organizationId) return apiError(409, "no_org", "La instancia aún no tiene organización");
  const body = await parseBody(req, bodySchema);
  if (!body.ok) return body.response;
  const ok = await handoffConversation({ organizationId, ...body.data });
  return ok
    ? Response.json({ ok: true })
    : apiError(404, "not_found", "Conversación no encontrada");
}

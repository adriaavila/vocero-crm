import { apiError } from "@/lib/api";
import { requireBotKey, resolveInstanceOrg } from "@/server/bot/auth";
import { getBotContext } from "@/server/bot/gateway";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = requireBotKey(req);
  if (denied) return denied;
  const organizationId = await resolveInstanceOrg();
  if (!organizationId) return apiError(409, "no_org", "La instancia aún no tiene organización");
  const identity = new URL(req.url).searchParams.get("waIdentity")?.trim();
  if (!identity || identity.length > 128) {
    return apiError(422, "invalid", "waIdentity inválida");
  }
  const context = await getBotContext(organizationId, identity);
  return context
    ? Response.json(context)
    : apiError(404, "not_found", "Identidad no encontrada");
}

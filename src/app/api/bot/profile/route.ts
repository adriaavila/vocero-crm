import { apiError } from "@/lib/api";
import { requireBotKey, resolveInstanceOrg } from "@/server/bot/auth";
import { getBotProfile } from "@/server/bot/gateway";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = requireBotKey(req);
  if (denied) return denied;
  const organizationId = await resolveInstanceOrg();
  if (!organizationId) return apiError(409, "no_org", "La instancia aún no tiene organización");
  const profile = await getBotProfile(organizationId);
  return profile
    ? Response.json(profile)
    : apiError(404, "not_found", "Perfil del agente no encontrado");
}

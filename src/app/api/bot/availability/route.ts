import { apiError } from "@/lib/api";
import { CalendarError, listAvailability } from "@/server/calendar";
import { requireBotKey, resolveInstanceOrg } from "@/server/bot/auth";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = requireBotKey(req);
  if (denied) return denied;
  const organizationId = await resolveInstanceOrg();
  if (!organizationId) return apiError(409, "no_org", "La instancia aún no tiene organización");
  const rawLimit = Number(new URL(req.url).searchParams.get("limit") ?? "6");
  const limit = Number.isInteger(rawLimit) ? Math.max(1, Math.min(rawLimit, 20)) : 6;
  try {
    return Response.json({ slots: await listAvailability(organizationId, limit) });
  } catch (error) {
    if (error instanceof CalendarError) {
      return apiError(503, error.code, error.message);
    }
    throw error;
  }
}

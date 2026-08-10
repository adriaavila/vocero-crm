import { z } from "zod";
import { apiError, parseBody } from "@/lib/api";
import {
  CalendarError,
  createBooking,
  listAvailability,
} from "@/server/calendar";
import { requireBotKey, resolveInstanceOrg } from "@/server/bot/auth";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  conversationId: z.string().min(1),
  startUtc: z.string().datetime({ offset: true }),
});

export async function POST(req: Request) {
  const denied = requireBotKey(req);
  if (denied) return denied;
  const organizationId = await resolveInstanceOrg();
  if (!organizationId) return apiError(409, "no_org", "La instancia aún no tiene organización");
  const body = await parseBody(req, bodySchema);
  if (!body.ok) return body.response;
  try {
    const booking = await createBooking({ organizationId, ...body.data });
    if (!booking) {
      const slots = await listAvailability(organizationId, 6).catch(() => []);
      return Response.json({ code: "slot_taken", slots }, { status: 409 });
    }
    return Response.json(booking, { status: 201 });
  } catch (error) {
    if (error instanceof CalendarError) {
      return apiError(503, error.code, error.message);
    }
    throw error;
  }
}

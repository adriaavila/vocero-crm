import { z } from "zod";
import { apiError, parseBody, withOwner } from "@/lib/api";
import { isAllokSaaSMode } from "@/lib/tenant-host";
import { hasSaaSPlan } from "@/server/agencia/entitlements";
import {
  BusinessHoursError,
  getBusinessHours,
  saveBusinessHours,
} from "@/server/business-hours";

export const dynamic = "force-dynamic";

const intervalSchema = z.object({
  start: z.string().trim(),
  end: z.string().trim(),
});

const bodySchema = z.object({
  weeklyHours: z.record(z.string(), z.array(intervalSchema).max(4).optional()),
  timezone: z.string().trim().min(1).max(80),
  responseMode: z.enum(["outside_hours", "all_day"]),
});

export const GET = withOwner(async (session) => {
  const settings = await getBusinessHours(session.organizationId);
  return Response.json({
    settings,
    canUseAllDay: !isAllokSaaSMode() || await hasSaaSPlan(session.organizationId, "pro"),
  });
});

export const PUT = withOwner(async (session, request: Request) => {
  const body = await parseBody(request, bodySchema);
  if (!body.ok) return body.response;
  if (
    isAllokSaaSMode() &&
    body.data.responseMode === "all_day" &&
    !(await hasSaaSPlan(session.organizationId, "pro"))
  ) {
    return apiError(402, "pro_required", "La atención todo el día está disponible en Completo.");
  }

  try {
    return Response.json({ settings: await saveBusinessHours(session.organizationId, body.data) });
  } catch (error) {
    if (error instanceof BusinessHoursError) {
      return apiError(422, "invalid_business_hours", error.message);
    }
    throw error;
  }
});

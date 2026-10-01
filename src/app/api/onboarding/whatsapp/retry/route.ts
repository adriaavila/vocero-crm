import { errorKeyForStep } from "@/lib/onboarding-errors";
import { withOwner } from "@/lib/api";
import { checkRateLimit } from "@/lib/rate-limit";
import { retryActivation } from "@/server/onboarding/status";

export const dynamic = "force-dynamic";

/** `POST /api/onboarding/whatsapp/retry` — termina de activar un número ya guardado. */
export const POST = withOwner(async (session) => {
  const rl = checkRateLimit(`wa-onboarding-retry:${session.organizationId}`, { windowMs: 10 * 60 * 1000, max: 10 });
  if (!rl.allowed) {
    return Response.json({ ok: false, errorKey: "meta_unavailable" }, { status: 429 });
  }
  const result = await retryActivation(session.organizationId);
  if (!result.ok) {
    return Response.json({ ok: false, step: result.step, errorKey: errorKeyForStep(result.step) }, { status: result.status });
  }
  return Response.json({ ok: true });
});

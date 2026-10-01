import { z } from "zod";
import { isEmbeddedSignupConfigured } from "@/lib/env";
import { errorKeyForCancel } from "@/lib/onboarding-errors";
import { checkRateLimit } from "@/lib/rate-limit";
import { authorizeSignupRequest } from "@/server/agencia/whatsapp-signup/request-auth";
import { markError } from "@/server/onboarding/whatsapp-onboarding";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  state: z.string().trim().min(1),
  mode: z.enum(["coexistence", "cloud_api"]),
  event: z.literal("CANCEL"),
  currentStep: z.string().trim().max(64).optional(),
  errorCode: z.union([z.string(), z.number()]).optional(),
  errorMessage: z.string().max(500).optional(),
});

/**
 * `POST /api/whatsapp/embedded-signup/event` — el dueño cerró la ventana de
 * Meta o Meta reportó un error dentro de ella. Se guarda en el onboarding
 * (paso, código, dónde cerró) para que pueda retomar y soporte lo vea. Mismo
 * candado que `complete`: estado firmado + sesión + propietario.
 */
export async function POST(request: Request): Promise<Response> {
  if (!isEmbeddedSignupConfigured()) {
    return Response.json({ error: "not_configured" }, { status: 503 });
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_body" }, { status: 422 });
  const body = parsed.data;

  const auth = await authorizeSignupRequest(request, body.state, body.mode);
  if (!auth.ok) return Response.json({ error: auth.message, step: auth.step }, { status: auth.status });

  const rl = checkRateLimit(`wa-signup-event:${auth.state.userId}`, { windowMs: 10 * 60 * 1000, max: 30 });
  if (!rl.allowed) return Response.json({ error: "rate_limited" }, { status: 429 });

  const errorKey = errorKeyForCancel(body.errorCode);
  await markError(auth.state.orgId, {
    step: errorKey,
    code: body.errorCode ?? null,
    detail: body.errorMessage ?? null,
    cancelledAtStep: body.currentStep ?? null,
  });
  return Response.json({ ok: true, errorKey });
}

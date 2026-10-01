import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { isEmbeddedSignupConfigured } from "@/lib/env";
import { errorKeyForStep } from "@/lib/onboarding-errors";
import { checkRateLimit } from "@/lib/rate-limit";
import { isAllokSaaSMode } from "@/lib/tenant-host";
import { appOrigin, tenantOrigin } from "@/server/saas/billing";
import { runEmbeddedSignupCompletion } from "@/server/agencia/whatsapp-signup/complete";
import { completeSignupSchema } from "@/server/agencia/whatsapp-signup/payload";
import { authorizeSignupRequest } from "@/server/agencia/whatsapp-signup/request-auth";
import { buildClearStateCookieHeader } from "@/server/agencia/whatsapp-signup/state";

/** 10 intentos / 10 minutos por usuario: la conexión real toma uno o dos. */
const COMPLETE_RATE_LIMIT = { windowMs: 10 * 60 * 1000, max: 10 };

export const dynamic = "force-dynamic";

function fail(
  status: number,
  step: string,
  message: string,
  missingPermissions?: string[]
): Response {
  return Response.json(
    {
      error: message,
      step,
      errorKey: errorKeyForStep(step),
      ...(missingPermissions ? { missingPermissions } : {}),
    },
    { status }
  );
}

/**
 * `POST /api/whatsapp/embedded-signup/complete` — el paso a) del spec vive
 * aquí (cookie/estado/sesión); b)-k) están en `complete.ts` para poder
 * probarse sin `Request`/cookies/Better Auth de por medio.
 */
export async function POST(request: Request): Promise<Response> {
  if (!isEmbeddedSignupConfigured()) {
    return fail(503, "config", "La conexión de WhatsApp en la app no está configurada.");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail(400, "body", "El cuerpo debe ser JSON válido.");
  }
  const parsed = completeSignupSchema.safeParse(body);
  if (!parsed.success) {
    return fail(422, "body", parsed.error.issues.map((i) => i.message).join("; "));
  }
  const payload = parsed.data;

  const auth = await authorizeSignupRequest(request, payload.state, payload.mode);
  if (!auth.ok) return fail(auth.status, auth.step, auth.message);
  const { state } = auth;

  const rl = checkRateLimit(`wa-signup-complete:${state.userId}`, COMPLETE_RATE_LIMIT);
  if (!rl.allowed) {
    return fail(429, "rate_limited", "Demasiados intentos. Espera unos minutos y vuelve a intentar.");
  }

  const result = await runEmbeddedSignupCompletion({
    organizationId: state.orgId,
    mode: state.mode,
    payload,
  });

  if (!result.ok) {
    return fail(result.status, result.step, result.error, result.missingPermissions);
  }

  // Solo el SaaS tiene subdominio por inquilino; una instancia dedicada es un
  // único host (tenantOrigin asumiría un slug que no existe como dominio).
  let redirectTo: string | undefined;
  if (isAllokSaaSMode()) {
    const org = await getDb()
      .select({ slug: schema.organization.slug })
      .from(schema.organization)
      .where(eq(schema.organization.id, state.orgId))
      .limit(1);
    redirectTo = org[0]?.slug
      ? `${tenantOrigin(org[0].slug, request)}/settings/whatsapp?connected=1`
      : undefined;
  } else {
    redirectTo = `${appOrigin(request)}/settings/whatsapp?connected=1`;
  }

  const response = Response.json({
    ok: true,
    displayPhoneNumber: result.displayPhoneNumber,
    verifiedName: result.verifiedName,
    mode: result.mode,
    redirectTo,
  });
  response.headers.set("Set-Cookie", buildClearStateCookieHeader());
  return response;
}

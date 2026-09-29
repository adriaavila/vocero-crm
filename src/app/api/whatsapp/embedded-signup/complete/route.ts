import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { getAuth } from "@/lib/auth";
import { getEnv, isEmbeddedSignupConfigured } from "@/lib/env";
import { checkRateLimit } from "@/lib/rate-limit";
import { isAllokSaaSMode } from "@/lib/tenant-host";
import { appOrigin, tenantOrigin } from "@/server/saas/billing";
import { isStillOwner } from "@/server/agencia/whatsapp-signup/auth";
import { runEmbeddedSignupCompletion } from "@/server/agencia/whatsapp-signup/complete";
import { completeSignupSchema } from "@/server/agencia/whatsapp-signup/payload";
import {
  buildClearStateCookieHeader,
  readStateCookie,
  verifySignupState,
} from "@/server/agencia/whatsapp-signup/state";

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
    { error: message, step, ...(missingPermissions ? { missingPermissions } : {}) },
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

  const env = getEnv();
  const cookieState = readStateCookie(request.headers.get("cookie"));
  // Igualdad exacta cookie ↔ body, como allok.fun: cualquier diferencia es
  // sesión ajena o reuso de un estado viejo.
  if (!cookieState || cookieState !== payload.state) {
    return fail(403, "state", "La sesión de conexión falta o no coincide. Vuelve a intentar.");
  }
  const state = verifySignupState(cookieState, env.META_APP_SECRET);
  if (!state) {
    return fail(403, "state", "La sesión de conexión expiró o no es válida. Vuelve a intentar.");
  }
  if (state.mode !== payload.mode) {
    return fail(400, "state", "El modo de conexión no coincide con el que iniciaste.");
  }

  const session = await getAuth()
    .api.getSession({ headers: request.headers })
    .catch(() => null);
  if (!session || session.user.id !== state.userId) {
    return fail(401, "session", "Tu sesión expiró. Vuelve a iniciar sesión e intenta de nuevo.");
  }
  if (!(await isStillOwner(state.userId, state.orgId))) {
    return fail(403, "membership", "Ya no eres propietario de este negocio.");
  }

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

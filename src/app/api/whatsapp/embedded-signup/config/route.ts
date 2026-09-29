import { getCredentialsByOrg } from "@/server/whatsapp/credentials";
import { canAutomate } from "@/server/agencia/entitlements";
import { resolveOwnerForOrgSlug } from "@/server/agencia/whatsapp-signup/auth";
import {
  buildStateCookieHeader,
  createSignupState,
  type EmbeddedSignupMode,
} from "@/server/agencia/whatsapp-signup/state";
import { getEnv, isEmbeddedSignupCloudApiConfigured, isEmbeddedSignupConfigured } from "@/lib/env";
import { isAllokSaaSMode } from "@/lib/tenant-host";

export const dynamic = "force-dynamic";

/**
 * `GET /api/whatsapp/embedded-signup/config?org=<slug>&mode=coexistence|cloud_api`
 *
 * Vive en el host de la app (bridge, fuera del subdominio del inquilino).
 * Autentica por MEMBRESÍA del slug pedido, no por host (ver `auth.ts`): a
 * diferencia del bridge de checkout, este SIEMPRE necesita saber para qué
 * negocio exacto es, porque el propio Embedded Signup va a guardar
 * credenciales de ESE negocio.
 */
export async function GET(request: Request): Promise<Response> {
  if (!isEmbeddedSignupConfigured()) {
    return Response.json(
      { error: "not_configured", message: "La conexión de WhatsApp en la app no está configurada." },
      { status: 503 }
    );
  }

  const url = new URL(request.url);
  const orgSlug = url.searchParams.get("org")?.trim().toLowerCase();
  if (!orgSlug) {
    return Response.json(
      { error: "missing_org", message: "Falta el negocio a conectar." },
      { status: 400 }
    );
  }

  const requestedMode = url.searchParams.get("mode");
  const mode: EmbeddedSignupMode = requestedMode === "cloud_api" ? "cloud_api" : "coexistence";
  if (mode === "cloud_api" && !isEmbeddedSignupCloudApiConfigured()) {
    return Response.json(
      { error: "mode_unavailable", message: "La conexión de número nuevo no está disponible." },
      { status: 400 }
    );
  }

  const resolved = await resolveOwnerForOrgSlug(request.headers, orgSlug);
  if (!resolved.ok) {
    if (resolved.reason === "no_session") {
      return Response.json(
        { error: "session_expired", message: "Tu sesión expiró. Vuelve a iniciar sesión." },
        { status: 401 }
      );
    }
    if (resolved.reason === "not_owner") {
      return Response.json(
        { error: "forbidden", message: "Solo el propietario del negocio puede conectar WhatsApp." },
        { status: 403 }
      );
    }
    return Response.json(
      { error: "org_not_found", message: "No encontramos ese negocio." },
      { status: 404 }
    );
  }
  const { context } = resolved;

  if (isAllokSaaSMode() && !(await canAutomate(context.organizationId))) {
    return Response.json(
      {
        error: "billing_inactive",
        message: "Activa tu plan para conectar un número de WhatsApp.",
      },
      { status: 402 }
    );
  }

  const env = getEnv();
  const state = createSignupState(
    { orgId: context.organizationId, userId: context.userId, mode },
    env.META_APP_SECRET
  );
  if (!state) {
    return Response.json(
      {
        error: "not_configured",
        message: "Falta META_APP_SECRET para firmar la conexión.",
      },
      { status: 503 }
    );
  }

  const existing = await getCredentialsByOrg(context.organizationId);

  const response = Response.json({
    appId: env.META_APP_ID,
    configId: mode === "coexistence" ? env.META_ES_CONFIG_ID : undefined,
    cloudApiConfigId: mode === "cloud_api" ? env.META_ES_CONFIG_ID_CLOUD_API : undefined,
    graphVersion: env.META_GRAPH_API_VERSION,
    mode,
    state,
    organizationName: context.organizationName,
    cloudApiAvailable: isEmbeddedSignupCloudApiConfigured(),
    connection: existing
      ? {
          displayPhoneNumber: existing.displayPhoneNumber,
          verifiedName: existing.verifiedName,
          status: existing.status,
        }
      : null,
  });
  response.headers.set("Set-Cookie", buildStateCookieHeader(state));
  return response;
}

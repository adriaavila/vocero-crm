import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { MetaApiError } from "@/lib/meta/client";
import { saveCredentials } from "@/server/whatsapp/credentials";
import { syncTemplates } from "@/server/whatsapp/templates";
import {
  debugBusinessToken,
  exchangeCodeForToken,
  getMissingPermissions,
  getPhoneCoexistenceStatus,
  registerPhoneNumber,
  requestSmbAppDataSync,
  resolveConnection,
  subscribeWabaOverride,
  verifyOverrideWithRetry,
} from "./graph";
import { deriveRegistrationPin } from "./pin";
import { isDuplicatePhoneNumberError, type CompleteSignupPayload } from "./payload";
import type { EmbeddedSignupMode } from "./state";
import { alreadySyncedForPhone, getWhatsappSignupSync, recordWhatsappSignupSync } from "./sync-guard";

/**
 * Orquesta `POST /api/whatsapp/embedded-signup/complete` (pasos b-k del spec:
 * la ruta ya verificó cookie/estado/sesión — eso es a). Orden OBLIGATORIO:
 * credenciales primero, webhook después, sync al final — si el webhook se
 * moviera antes, un mensaje podría llegar a una instancia que aún no conoce el
 * número; si el sync se pidiera antes de confirmar el webhook, se gastaría la
 * única oportunidad de importar sin un lugar a donde entregarlo.
 */

export type CompleteSignupSuccess = {
  ok: true;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  mode: EmbeddedSignupMode;
};

export type CompleteSignupFailure = {
  ok: false;
  status: number;
  step: string;
  error: string;
  missingPermissions?: string[];
};

export type CompleteSignupResult = CompleteSignupSuccess | CompleteSignupFailure;

function fail(
  status: number,
  step: string,
  error: string,
  extra: Partial<CompleteSignupFailure> = {}
): CompleteSignupFailure {
  return { ok: false, status, step, error, ...extra };
}

function metaMessage(err: unknown, fallback: string): string {
  if (err instanceof MetaApiError) return err.message || fallback;
  return err instanceof Error ? err.message : fallback;
}

export async function runEmbeddedSignupCompletion(input: {
  organizationId: string;
  mode: EmbeddedSignupMode;
  payload: CompleteSignupPayload;
}): Promise<CompleteSignupResult> {
  const { organizationId, mode, payload } = input;

  // b) intercambio del code — vive 30s, se hace de inmediato.
  let token: string;
  try {
    token = await exchangeCodeForToken(payload.code);
  } catch (err) {
    return fail(
      502,
      "exchange",
      metaMessage(err, "Meta no pudo intercambiar el código de autorización.")
    );
  }

  // c) token de negocio válido + permisos requeridos.
  let debug;
  try {
    debug = await debugBusinessToken(token);
  } catch (err) {
    return fail(502, "debug_token", metaMessage(err, "Meta no pudo validar el token de negocio."));
  }
  if (debug.is_valid === false) {
    return fail(502, "debug_token", "Meta devolvió un token de negocio inválido.");
  }
  const missingPermissions = getMissingPermissions(debug);
  if (missingPermissions.length > 0) {
    return fail(
      403,
      "permissions",
      "Falta autorizar permisos de WhatsApp en Meta.",
      { missingPermissions }
    );
  }

  // d) resolver WABA + número (del evento del SDK, o por descubrimiento).
  let resolved;
  try {
    resolved = await resolveConnection({
      token,
      wabaId: payload.wabaId,
      phoneNumberId: payload.phoneNumberId,
      debug,
    });
  } catch (err) {
    return fail(502, "resolve", metaMessage(err, "No se pudo confirmar el número en Meta."));
  }
  if (!resolved) {
    return fail(
      409,
      "resolve",
      "No pudimos identificar un único número de WhatsApp para conectar."
    );
  }
  const { wabaId, phoneNumberId, phoneProfile } = resolved;

  // e) ese número no puede estar atado a OTRA organización (pre-chequeo;
  // la carrera real la cierra el catch de unique_violation más abajo).
  const clash = await getDb()
    .select({ organizationId: schema.metaCredentials.organizationId })
    .from(schema.metaCredentials)
    .where(eq(schema.metaCredentials.phoneNumberId, phoneNumberId))
    .limit(1);
  if (clash[0] && clash[0].organizationId !== organizationId) {
    return fail(409, "phone_in_use", "Ese número de WhatsApp ya está conectado a otro negocio.");
  }

  // f) CREDENCIALES PRIMERO.
  try {
    await saveCredentials({
      organizationId,
      wabaId,
      phoneNumberId,
      token,
      displayPhoneNumber: phoneProfile.display_phone_number ?? null,
      verifiedName: phoneProfile.verified_name ?? null,
    });
  } catch (err) {
    if (isDuplicatePhoneNumberError(err)) {
      return fail(409, "phone_in_use", "Ese número de WhatsApp ya está conectado a otro negocio.");
    }
    throw err;
  }

  // g) WEBHOOK SEGUNDO: override a esta instancia + verificación con reintentos.
  const env = getEnv();
  const callbackUri = new URL(
    `/api/webhooks/wa/${env.META_WEBHOOK_VERIFY_TOKEN}`,
    env.APP_BASE_URL
  ).toString();
  try {
    await subscribeWabaOverride({
      wabaId,
      token,
      callbackUri,
      verifyToken: env.META_WEBHOOK_VERIFY_TOKEN,
    });
  } catch (err) {
    return fail(502, "webhook", metaMessage(err, "Meta rechazó el enlace del webhook."));
  }
  let overrideConfirmed: boolean;
  try {
    overrideConfirmed = await verifyOverrideWithRetry({
      wabaId,
      token,
      callbackUri,
      appId: env.META_APP_ID,
    });
  } catch (err) {
    return fail(502, "webhook_verify", metaMessage(err, "No se pudo confirmar el webhook en Meta."));
  }
  if (!overrideConfirmed) {
    return fail(502, "webhook_verify", "Meta no confirmó el enlace del webhook. Vuelve a intentar.");
  }

  // h) Cloud API: registrar el número. Coexistencia JAMÁS se registra — eso
  // lo sacaría de la app de WhatsApp Business del cliente.
  if (mode === "cloud_api") {
    const pin = deriveRegistrationPin(phoneNumberId, env.ENCRYPTION_KEY);
    try {
      await registerPhoneNumber({ phoneNumberId, token, pin });
    } catch (err) {
      return fail(502, "register", metaMessage(err, "Meta rechazó el alta del número."));
    }
  }

  // i) Coexistencia: SYNC AL FINAL, una sola vez por número (Meta solo deja
  // pedir cada tipo una vez). Best-effort a propósito: el número ya quedó
  // conectado y recibiendo — un tropiezo en la importación no puede tirar el
  // alta completa.
  if (mode === "coexistence") {
    try {
      const already = await getWhatsappSignupSync(organizationId);
      if (!alreadySyncedForPhone(already, phoneNumberId)) {
        const [, contactSync, historySync] = await Promise.allSettled([
          getPhoneCoexistenceStatus(phoneNumberId, token),
          requestSmbAppDataSync({ phoneNumberId, token, syncType: "smb_app_state_sync" }),
          requestSmbAppDataSync({ phoneNumberId, token, syncType: "history" }),
        ]);
        await recordWhatsappSignupSync(organizationId, {
          phoneNumberId,
          mode,
          syncRequestedAt: new Date().toISOString(),
          requestIds: {
            smb_app_state_sync:
              contactSync.status === "fulfilled" ? contactSync.value.requestId : null,
            history: historySync.status === "fulfilled" ? historySync.value.requestId : null,
          },
        });
      }
    } catch (err) {
      console.warn(
        "[whatsapp-signup] no se pudo pedir el sync de coexistencia (no bloquea el alta):",
        err instanceof Error ? err.message : err
      );
    }
  }

  // j) plantillas, mejor esfuerzo.
  try {
    await syncTemplates(organizationId);
  } catch (err) {
    console.warn(
      "[whatsapp-signup] sync de plantillas falló (no bloquea el alta):",
      err instanceof Error ? err.message : err
    );
  }

  return {
    ok: true,
    displayPhoneNumber: phoneProfile.display_phone_number ?? null,
    verifiedName: phoneProfile.verified_name ?? null,
    mode,
  };
}

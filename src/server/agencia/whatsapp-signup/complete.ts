import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { MetaApiError } from "@/lib/meta/client";
import { saveCredentials } from "@/server/whatsapp/credentials";
import { syncTemplates } from "@/server/whatsapp/templates";
import { copyForStep } from "./copy";
import {
  debugBusinessToken,
  exchangeCodeForToken,
  getMissingPermissions,
  getPhoneCoexistenceStatus,
  PIN_MISMATCH_CODE,
  registerPhoneNumber,
  requestSmbAppDataSync,
  resolveConnection,
  subscribeWabaOverride,
  verifyOverrideWithRetry,
} from "./graph";
import { deriveRegistrationPin } from "./pin";
import { isDuplicatePhoneNumberError, type CompleteSignupPayload } from "./payload";
import type { EmbeddedSignupMode } from "./state";
import {
  claimWhatsappSignupSync,
  clearWhatsappSignupError,
  finalizeWhatsappSignupSync,
  recordWhatsappSignupError,
  releaseWhatsappSignupSync,
} from "./sync-guard";

/**
 * Orquesta `POST /api/whatsapp/embedded-signup/complete` (pasos b-k del spec:
 * la ruta ya verificó cookie/estado/sesión — eso es a). Orden OBLIGATORIO:
 * credenciales primero, webhook después, sync al final — si el webhook se
 * moviera antes, un mensaje podría llegar a una instancia que aún no conoce el
 * número; si el sync se pidiera antes de confirmar el webhook, se gastaría la
 * única oportunidad de importar sin un lugar a donde entregarlo.
 *
 * Ningún mensaje de error de Meta llega tal cual al cliente (copyForStep):
 * el motivo real se loguea aquí para quien opere la instancia.
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
  extra: Partial<CompleteSignupFailure> = {}
): CompleteSignupFailure {
  return { ok: false, status, step, error: copyForStep(step), ...extra };
}

function logMetaError(step: string, err: unknown): void {
  const detail =
    err instanceof MetaApiError
      ? `${err.message} (status=${err.status} code=${err.code ?? "?"})`
      : err instanceof Error
        ? err.message
        : String(err);
  console.error(`[whatsapp-signup] paso "${step}" falló:`, detail);
}

export async function runEmbeddedSignupCompletion(input: {
  organizationId: string;
  mode: EmbeddedSignupMode;
  payload: CompleteSignupPayload;
}): Promise<CompleteSignupResult> {
  const { organizationId, mode, payload } = input;

  // Registra el paso que falla en organization.metadata, para que
  // /config pueda avisar "falta activar la recepción de mensajes" con un
  // número YA guardado (saveCredentials corrió en f) pero sin webhook
  // confirmado. `phoneNumberId` puede no existir todavía (falla antes de d).
  async function failAndRecord(
    status: number,
    step: string,
    phoneNumberIdForError: string | null,
    extra: Partial<CompleteSignupFailure> = {}
  ): Promise<CompleteSignupFailure> {
    if (phoneNumberIdForError) {
      await recordWhatsappSignupError(organizationId, phoneNumberIdForError, step).catch(() => {});
    }
    return fail(status, step, extra);
  }

  // b) intercambio del code — vive 30s, se hace de inmediato.
  let token: string;
  try {
    token = await exchangeCodeForToken(payload.code);
  } catch (err) {
    logMetaError("exchange", err);
    return fail(502, "exchange");
  }

  // c) token de negocio válido + permisos requeridos.
  let debug;
  try {
    debug = await debugBusinessToken(token);
  } catch (err) {
    logMetaError("debug_token", err);
    return fail(502, "debug_token");
  }
  if (debug.is_valid === false) {
    return fail(502, "debug_token");
  }
  const missingPermissions = getMissingPermissions(debug);
  if (missingPermissions.length > 0) {
    return fail(403, "permissions", { missingPermissions });
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
    logMetaError("resolve", err);
    return fail(502, "resolve");
  }
  if (!resolved) {
    return fail(409, "resolve");
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
    return fail(409, "phone_in_use");
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
      return fail(409, "phone_in_use");
    }
    throw err;
  }

  // g) WEBHOOK SEGUNDO: override a esta instancia + verificación con reintentos.
  // Cualquier fallo de aquí en adelante ya tiene credenciales guardadas: se
  // anota en organization.metadata para que /config pueda mostrar "falta
  // activar la recepción de mensajes" en vez de un simple "conectado".
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
    logMetaError("webhook", err);
    return failAndRecord(502, "webhook", phoneNumberId);
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
    logMetaError("webhook_verify", err);
    return failAndRecord(502, "webhook_verify", phoneNumberId);
  }
  if (!overrideConfirmed) {
    return failAndRecord(502, "webhook_verify", phoneNumberId);
  }

  // h) Cloud API: registrar el número. Coexistencia JAMÁS se registra — eso
  // lo sacaría de la app de WhatsApp Business del cliente.
  if (mode === "cloud_api") {
    const pin = deriveRegistrationPin(phoneNumberId, env.ENCRYPTION_KEY);
    try {
      await registerPhoneNumber({ phoneNumberId, token, pin });
    } catch (err) {
      logMetaError("register", err);
      // 133005 confirmado en la documentación de Meta: PIN de verificación en
      // dos pasos incorrecto — significa que ESTE número ya tiene un PIN
      // distinto puesto por otra parte (Meta, otra herramienta). Credenciales
      // y webhook ya quedaron bien: es un problema puntual de ese número, no
      // del alta, y el dueño necesita el PIN real, no un reintento genérico.
      const step =
        err instanceof MetaApiError && err.code === PIN_MISMATCH_CODE
          ? "register_pin_mismatch"
          : "register";
      return failAndRecord(502, step, phoneNumberId);
    }
  }

  // i) Coexistencia: SYNC AL FINAL, con reserva atómica ANTES de llamar a
  // Meta (cada tipo es de un solo uso — dos completions concurrentes del
  // mismo número no pueden las dos ganar la reserva).
  if (mode === "coexistence") {
    try {
      const claimed = await claimWhatsappSignupSync(organizationId, phoneNumberId, mode);
      if (claimed) {
        const [, contactSync, historySync] = await Promise.allSettled([
          getPhoneCoexistenceStatus(phoneNumberId, token),
          requestSmbAppDataSync({ phoneNumberId, token, syncType: "smb_app_state_sync" }),
          requestSmbAppDataSync({ phoneNumberId, token, syncType: "history" }),
        ]);
        const bothFailed = contactSync.status === "rejected" && historySync.status === "rejected";
        if (bothFailed) {
          // Ninguno de los dos llegó a gastar su única oportunidad: libera la
          // reserva para que un reintento pueda de verdad volver a pedirlos.
          await releaseWhatsappSignupSync(organizationId, phoneNumberId);
        } else {
          await finalizeWhatsappSignupSync(organizationId, phoneNumberId, {
            smb_app_state_sync:
              contactSync.status === "fulfilled" ? contactSync.value.requestId : null,
            history: historySync.status === "fulfilled" ? historySync.value.requestId : null,
          });
        }
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

  // k) éxito completo: cualquier aviso de "falta activar" anterior ya no aplica.
  await clearWhatsappSignupError(organizationId).catch(() => {});

  return {
    ok: true,
    displayPhoneNumber: phoneProfile.display_phone_number ?? null,
    verifiedName: phoneProfile.verified_name ?? null,
    mode,
  };
}

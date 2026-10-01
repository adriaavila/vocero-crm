import { eq, or } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { MetaApiError } from "@/lib/meta/client";
import { saveCredentials } from "@/server/whatsapp/credentials";
import { syncTemplates } from "@/server/whatsapp/templates";
import { markConnected, markError, markWebhookOk } from "@/server/onboarding/whatsapp-onboarding";
import { copyForStep } from "./copy";
import {
  debugBusinessToken,
  exchangeCodeForToken,
  getMissingPermissions,
  getPhoneCoexistenceStatus,
  NOT_VERIFIED_CODE,
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

type MetaErrorInfo = { code: string | null; detail: string };

function describeMetaError(err: unknown): MetaErrorInfo {
  if (err instanceof MetaApiError) {
    return {
      code: err.code == null ? null : String(err.code),
      detail: `${err.message} (status=${err.status} code=${err.code ?? "?"})`,
    };
  }
  return { code: null, detail: err instanceof Error ? err.message : String(err) };
}

/** Anota el último error de Meta de un alta para guardarlo en el estado del onboarding. */
export type MetaErrorSink = (step: string, err: unknown) => void;

export function metaErrorSink(): { log: MetaErrorSink; last: () => MetaErrorInfo | null } {
  let last: MetaErrorInfo | null = null;
  return {
    log(step, err) {
      last = describeMetaError(err);
      console.error(`[whatsapp-signup] paso "${step}" falló:`, last.detail);
    },
    last: () => last,
  };
}

export async function runEmbeddedSignupCompletion(input: {
  organizationId: string;
  mode: EmbeddedSignupMode;
  payload: CompleteSignupPayload;
}): Promise<CompleteSignupResult> {
  const sink = metaErrorSink();
  const result = await completeSteps(input, sink.log);
  if (!result.ok) {
    const meta = sink.last();
    await markError(input.organizationId, {
      step: result.step,
      code: meta?.code ?? null,
      detail: meta?.detail ?? null,
    }).catch((err) => console.error("[whatsapp-signup] no se pudo anotar el error del alta:", err));
  }
  return result;
}

async function completeSteps(
  input: { organizationId: string; mode: EmbeddedSignupMode; payload: CompleteSignupPayload },
  logMetaError: MetaErrorSink,
): Promise<CompleteSignupResult> {
  const { organizationId, mode, payload } = input;

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

  // e) ni el número ni su WABA pueden estar atados a OTRA organización
  // (decisión de Adrian, 2026-09-30: se bloquea y soporte lo mueve; nunca se
  // reasigna solo). La carrera real del número la cierra el catch de
  // unique_violation más abajo.
  const clashes = await getDb()
    .select({
      organizationId: schema.metaCredentials.organizationId,
      phoneNumberId: schema.metaCredentials.phoneNumberId,
    })
    .from(schema.metaCredentials)
    .where(
      or(
        eq(schema.metaCredentials.phoneNumberId, phoneNumberId),
        eq(schema.metaCredentials.wabaId, wabaId)
      )
    );
  const foreign = clashes.find((row) => row.organizationId !== organizationId);
  if (foreign) {
    return fail(409, foreign.phoneNumberId === phoneNumberId ? "phone_in_use" : "waba_in_use");
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
  await markConnected(organizationId, { mode, wabaId, phoneNumberId });

  // g + h) webhook y, en número nuevo, registro.
  const activation = await activateNumber({ organizationId, wabaId, phoneNumberId, token, mode }, logMetaError);
  if (!activation.ok) {
    await recordWhatsappSignupError(organizationId, phoneNumberId, activation.step).catch(() => {});
    return activation;
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

/**
 * g) webhook a esta instancia (override + verificación) y h) registro del
 * número nuevo. Idempotente: suscribir y registrar otra vez no rompe nada, así
 * que sirve igual para el alta y para "Reintentar" con el token ya guardado
 * (sin abrir otra vez la ventana de Meta). Marca `webhook_ok` al terminar.
 */
export async function activateNumber(
  input: {
    organizationId: string;
    wabaId: string;
    phoneNumberId: string;
    token: string;
    mode: EmbeddedSignupMode;
  },
  logMetaError: MetaErrorSink = metaErrorSink().log,
): Promise<{ ok: true } | CompleteSignupFailure> {
  const { organizationId, wabaId, phoneNumberId, token, mode } = input;
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
    return fail(502, "webhook");
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
    return fail(502, "webhook_verify");
  }
  if (!overrideConfirmed) {
    return fail(502, "webhook_verify");
  }

  // Coexistencia JAMÁS se registra: lo sacaría de la app de WhatsApp Business.
  if (mode === "cloud_api") {
    const pin = deriveRegistrationPin(phoneNumberId, env.ENCRYPTION_KEY);
    try {
      const { alreadyRegistered } = await registerPhoneNumber({ phoneNumberId, token, pin });
      if (alreadyRegistered) {
        // 133016 también es el límite de 10 registros en 72 h (docs de Meta):
        // solo cuenta como "ya registrado" si Meta dice que el número está en
        // Cloud API.
        const status = await getPhoneCoexistenceStatus(phoneNumberId, token).catch(() => null);
        if (status?.platformType !== "CLOUD_API") {
          return fail(429, "register_limit");
        }
      }
    } catch (err) {
      logMetaError("register", err);
      const code = err instanceof MetaApiError ? err.code : null;
      const step =
        code === PIN_MISMATCH_CODE
          ? "register_pin_mismatch"
          : code === NOT_VERIFIED_CODE
            ? "register_not_verified"
            : "register";
      return fail(502, step);
    }
  }

  await markWebhookOk(organizationId);
  return { ok: true };
}

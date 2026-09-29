import { getEnv } from "@/lib/env";
import { graphRequest, MetaApiError } from "@/lib/meta/client";

/**
 * Llamadas a Graph que solo existen para Embedded Signup EN la app (fork).
 * `graphRequest` (núcleo, `lib/meta/client.ts`) sigue siendo la ÚNICA
 * frontera de salida hacia Meta — aquí solo se compone sobre ella.
 */

export type DebugTokenData = {
  is_valid?: boolean;
  scopes?: string[];
  granular_scopes?: { scope?: string; target_ids?: string[] }[];
  app_id?: string;
  expires_at?: number;
  issued_at?: number;
};

export type PhoneProfile = {
  id: string;
  display_phone_number?: string;
  verified_name?: string;
};

export type SubscribedApp = {
  id?: string;
  override_callback_uri?: string | null;
};

/** Meta solo ofrece estos dos permisos en la config de Embedded Signup. */
export const REQUIRED_PERMISSIONS = [
  "whatsapp_business_management",
  "whatsapp_business_messaging",
] as const;

/** Código de error de Graph para "el número ya está registrado" — es el estado deseado. */
export const ALREADY_REGISTERED_CODE = 133016;

function requireAppCredentials(): { appId: string; appSecret: string } {
  const env = getEnv();
  if (!env.META_APP_ID || !env.META_APP_SECRET) {
    throw new Error(
      "META_APP_ID/META_APP_SECRET no configurados: Embedded Signup en la app requiere ambos"
    );
  }
  return { appId: env.META_APP_ID, appSecret: env.META_APP_SECRET };
}

/** `GET oauth/access_token` — intercambia el code de 30s por un token de negocio. Sin redirect_uri. */
export async function exchangeCodeForToken(code: string): Promise<string> {
  const { appId, appSecret } = requireAppCredentials();
  const data = await graphRequest<{ access_token?: string }>("oauth/access_token", {
    query: { client_id: appId, client_secret: appSecret, code },
  });
  if (!data.access_token) {
    throw new MetaApiError("Meta no devolvió un access_token", { status: 502 });
  }
  return data.access_token;
}

/** `GET debug_token` con token DE APP (`app_id|app_secret`), no el de la conexión. */
export async function debugBusinessToken(token: string): Promise<DebugTokenData> {
  const { appId, appSecret } = requireAppCredentials();
  const data = await graphRequest<{ data?: DebugTokenData }>("debug_token", {
    query: { input_token: token, access_token: `${appId}|${appSecret}` },
  });
  return data.data ?? {};
}

export function getMissingPermissions(debug: DebugTokenData): string[] {
  const granted = new Set(debug.scopes ?? []);
  for (const scope of debug.granular_scopes ?? []) {
    if (scope.scope) granted.add(scope.scope);
  }
  return REQUIRED_PERMISSIONS.filter((permission) => !granted.has(permission));
}

export async function listWabaPhoneNumbers(
  wabaId: string,
  token: string
): Promise<PhoneProfile[]> {
  const data = await graphRequest<{ data?: PhoneProfile[] }>(
    `${encodeURIComponent(wabaId)}/phone_numbers?fields=id,display_phone_number,verified_name`,
    { token }
  );
  return data.data ?? [];
}

/**
 * WABA + número del evento del SDK, o descubiertos por los scopes granulares
 * del token cuando faltan. Siempre verifica el número CONTRA la WABA (nunca
 * confía en un phone_number_id suelto): un par que no cuadra no puede hacer
 * que se suscriba una WABA y se guarde el teléfono de otra.
 */
export async function resolveConnection(input: {
  token: string;
  wabaId?: string | null;
  phoneNumberId?: string | null;
  debug: DebugTokenData;
}): Promise<{ wabaId: string; phoneNumberId: string; phoneProfile: PhoneProfile } | null> {
  if (input.wabaId && input.phoneNumberId) {
    const phones = await listWabaPhoneNumbers(input.wabaId, input.token);
    const phone = phones.find((p) => p.id === input.phoneNumberId);
    if (!phone) return null;
    return { wabaId: input.wabaId, phoneNumberId: input.phoneNumberId, phoneProfile: phone };
  }

  const candidateWabaIds = new Set<string>();
  if (input.wabaId) candidateWabaIds.add(input.wabaId);
  for (const scope of input.debug.granular_scopes ?? []) {
    if (!scope.scope?.startsWith("whatsapp_business_")) continue;
    for (const targetId of scope.target_ids ?? []) candidateWabaIds.add(targetId);
  }

  const candidates: { wabaId: string; phone: PhoneProfile }[] = [];
  for (const wabaId of candidateWabaIds) {
    try {
      const phones = await listWabaPhoneNumbers(wabaId, input.token);
      for (const phone of phones) candidates.push({ wabaId, phone });
    } catch (err) {
      if (!(err instanceof MetaApiError)) throw err;
      // WABA sin acceso real pese al scope: se descarta, no se revienta.
    }
  }

  const selected = input.phoneNumberId
    ? candidates.find((candidate) => candidate.phone.id === input.phoneNumberId)
    : candidates.length === 1
      ? candidates[0]
      : undefined;
  if (!selected) return null;

  return {
    wabaId: selected.wabaId,
    phoneNumberId: selected.phone.id,
    phoneProfile: selected.phone,
  };
}

export async function subscribeWabaOverride(input: {
  wabaId: string;
  token: string;
  callbackUri: string;
  verifyToken: string;
}): Promise<void> {
  await graphRequest<{ success?: boolean }>(
    `${encodeURIComponent(input.wabaId)}/subscribed_apps`,
    {
      method: "POST",
      token: input.token,
      body: { override_callback_uri: input.callbackUri, verify_token: input.verifyToken },
    }
  );
}

export async function listSubscribedApps(
  wabaId: string,
  token: string
): Promise<SubscribedApp[]> {
  const data = await graphRequest<{ data?: SubscribedApp[] }>(
    `${encodeURIComponent(wabaId)}/subscribed_apps`,
    { token }
  );
  return data.data ?? [];
}

function normalizeCallbackUri(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).toString();
  } catch {
    return null;
  }
}

/** Meta puede omitir el id de la app; la URL efectiva sigue siendo verificable. */
export function subscriptionMatchesOverride(
  app: SubscribedApp,
  appId: string | undefined,
  callbackUri: string
): boolean {
  return (
    (!app.id || !appId || app.id === appId) &&
    normalizeCallbackUri(app.override_callback_uri) === normalizeCallbackUri(callbackUri)
  );
}

function isRetryableGraphError(err: unknown): boolean {
  if (!(err instanceof MetaApiError)) return true; // fallo de red: también se reintenta
  return err.status === 0 || err.status === 429 || err.status >= 500;
}

const RETRY_DELAYS_MS = [250, 500];

/**
 * Relee `subscribed_apps` hasta confirmar el override, 3 intentos (250 ms,
 * 500 ms), solo ante red caída / 429 / 5xx — igual que el handover de
 * allok.fun (`lib/handover/destinations.ts`).
 */
export async function verifyOverrideWithRetry(input: {
  wabaId: string;
  token: string;
  callbackUri: string;
  appId: string | undefined;
}): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const apps = await listSubscribedApps(input.wabaId, input.token);
      return apps.some((app) => subscriptionMatchesOverride(app, input.appId, input.callbackUri));
    } catch (err) {
      if (!isRetryableGraphError(err) || attempt === 2) throw err;
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
    }
  }
  return false;
}

/**
 * Solo Cloud API: mueve el número de PENDING a operativo. JAMÁS en
 * coexistencia — sacaría el número de la app de WhatsApp Business del
 * cliente (el mismo guardrail que allok.fun).
 */
export async function registerPhoneNumber(input: {
  phoneNumberId: string;
  token: string;
  pin: string;
}): Promise<{ alreadyRegistered: boolean }> {
  try {
    await graphRequest<{ success?: boolean }>(
      `${encodeURIComponent(input.phoneNumberId)}/register`,
      {
        method: "POST",
        token: input.token,
        body: { messaging_product: "whatsapp", pin: input.pin },
      }
    );
    return { alreadyRegistered: false };
  } catch (err) {
    if (err instanceof MetaApiError && err.code === ALREADY_REGISTERED_CODE) {
      return { alreadyRegistered: true };
    }
    throw err;
  }
}

export async function getPhoneCoexistenceStatus(
  phoneNumberId: string,
  token: string
): Promise<{ isOnBizApp: boolean | null; platformType: string | null }> {
  const data = await graphRequest<{ is_on_biz_app?: boolean; platform_type?: string }>(
    `${encodeURIComponent(phoneNumberId)}?fields=is_on_biz_app,platform_type`,
    { token }
  );
  return { isOnBizApp: data.is_on_biz_app ?? null, platformType: data.platform_type ?? null };
}

/** Cada `syncType` es de un solo uso por número — el guard vive en `complete.ts`, no aquí. */
export async function requestSmbAppDataSync(input: {
  phoneNumberId: string;
  token: string;
  syncType: "history" | "smb_app_state_sync";
}): Promise<{ requestId: string | null }> {
  const data = await graphRequest<{ success?: boolean; request_id?: string }>(
    `${encodeURIComponent(input.phoneNumberId)}/smb_app_data`,
    {
      method: "POST",
      token: input.token,
      body: { messaging_product: "whatsapp", sync_type: input.syncType },
    }
  );
  return { requestId: data.request_id ?? null };
}

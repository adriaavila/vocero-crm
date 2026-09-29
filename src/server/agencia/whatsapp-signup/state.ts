import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Estado firmado de Embedded Signup EN la app (fork — no existe en upstream).
 *
 * Igual que allok.fun (`lib/meta/server.ts`): payload en base64url + firma
 * HMAC-SHA256 en base64url, separados por un punto. Puro a propósito — sin
 * DB, sin `getEnv()` — para poder probarse sin levantar Postgres ni Next.
 *
 * La clave es `META_APP_SECRET`: ya es obligatoria en esta instancia (la
 * constitución del fork la exige para el webhook) y así no hace falta un
 * secreto nuevo solo para esto.
 */

export type EmbeddedSignupMode = "coexistence" | "cloud_api";

export type SignupStateContext = {
  orgId: string;
  userId: string;
  mode: EmbeddedSignupMode;
  nonce: string;
  issuedAt: number;
  expiresAt: number;
};

export const SIGNUP_STATE_TTL_SECONDS = 15 * 60;
export const SIGNUP_STATE_COOKIE = "wa_embedded_signup_state";
/** Path-scoped: la cookie solo viaja hacia esta superficie, nunca al resto del CRM. */
export const SIGNUP_STATE_COOKIE_PATH = "/api/whatsapp/embedded-signup";

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function createSignupState(
  input: { orgId: string; userId: string; mode: EmbeddedSignupMode },
  secret: string | undefined,
  now = Date.now(),
): string | null {
  if (!secret) return null;
  const issuedAt = Math.floor(now / 1000);
  const context: SignupStateContext = {
    orgId: input.orgId,
    userId: input.userId,
    mode: input.mode,
    nonce: randomBytes(16).toString("base64url"),
    issuedAt,
    expiresAt: issuedAt + SIGNUP_STATE_TTL_SECONDS,
  };
  const payload = Buffer.from(JSON.stringify(context)).toString("base64url");
  return `${payload}.${sign(payload, secret)}`;
}

/**
 * Verifica firma, forma y vigencia. Timing-safe contra la firma; cualquier
 * otro defecto (forma, tipos, vencido) responde igual: null.
 */
export function verifySignupState(
  value: string | undefined | null,
  secret: string | undefined,
  now = Date.now(),
): SignupStateContext | null {
  if (!value || !secret) return null;
  const [payload, signature, ...extra] = value.split(".");
  if (!payload || !signature || extra.length > 0) return null;

  const expected = sign(payload, secret);
  const receivedBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expected);
  if (receivedBuf.length !== expectedBuf.length || !timingSafeEqual(receivedBuf, expectedBuf)) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const context = parsed as Record<string, unknown>;

  if (
    typeof context.orgId !== "string" || !context.orgId ||
    typeof context.userId !== "string" || !context.userId ||
    (context.mode !== "coexistence" && context.mode !== "cloud_api") ||
    typeof context.nonce !== "string" || !context.nonce ||
    typeof context.issuedAt !== "number" ||
    typeof context.expiresAt !== "number" ||
    context.expiresAt < Math.floor(now / 1000)
  ) {
    return null;
  }

  return context as unknown as SignupStateContext;
}

/**
 * `Request`/`Response` planos (como el resto de las rutas del repo, sin
 * `NextRequest`): la cookie se arma y se lee a mano en vez de con
 * `next/headers`, para no depender del contexto especial que esa API
 * necesita en un Route Handler.
 */
export function buildStateCookieHeader(value: string): string {
  const parts = [
    `${SIGNUP_STATE_COOKIE}=${value}`,
    `Max-Age=${SIGNUP_STATE_TTL_SECONDS}`,
    `Path=${SIGNUP_STATE_COOKIE_PATH}`,
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (process.env.NODE_ENV === "production") parts.push("Secure");
  return parts.join("; ");
}

export function buildClearStateCookieHeader(): string {
  return `${SIGNUP_STATE_COOKIE}=; Max-Age=0; Path=${SIGNUP_STATE_COOKIE_PATH}; HttpOnly; SameSite=Lax`;
}

export function readStateCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    if (name === SIGNUP_STATE_COOKIE) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

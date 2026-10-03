import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetRateLimit } from "@/lib/rate-limit";
import { resetEnvCacheForTests } from "@/lib/env";
import {
  RESET_EMAIL_LIMIT,
  RESET_TOKEN_TTL_SECONDS,
  buildPasswordResetEmail,
  sendPasswordResetEmail,
} from "@/server/agencia/restablecer-contrasena";

/**
 * "Olvidé mi contraseña": el texto del correo, el tope por correo, que el
 * envío no frene la respuesta, y que Better Auth solo exponga el flujo con el
 * conector de correo encendido.
 */

const URL_RESET = "http://localhost:3414/api/auth/reset-password/TOK123?callbackURL=%2Freset-password";
const fetchMock = vi.fn();

beforeEach(() => {
  resetRateLimit();
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: "msg_1" }), { status: 200 }));
  vi.stubEnv("BRAND", "");
  vi.stubEnv("RESEND_API_KEY", "re_test_key_1234567890");
  vi.stubEnv("EMAIL_FROM", "allok <no-reply@allok.fun>");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("buildPasswordResetEmail", () => {
  it("carries the link in text and html, in neutral Spanish with the brand name", () => {
    const mail = buildPasswordResetEmail({ to: "ana@ejemplo.com", url: URL_RESET });
    expect(mail.to).toBe("ana@ejemplo.com");
    expect(mail.subject).toBe("Restablece tu contraseña de allok");
    expect(mail.text).toContain(URL_RESET);
    expect(mail.html).toContain(`href="${URL_RESET}"`);
    expect(mail.text).toContain("El enlace vale 1 hora");
    expect(mail.html).toContain("El enlace vale 1 hora");
    expect(mail.text).toContain("Si no fuiste tú");
  });

  it("uses the active brand and never an em dash", () => {
    vi.stubEnv("BRAND", "rei");
    const mail = buildPasswordResetEmail({ to: "ana@ejemplo.com", url: URL_RESET });
    expect(mail.subject).toBe("Restablece tu contraseña de Rei");
    expect(mail.text).toContain("contraseña de Rei");
    for (const part of [mail.subject, mail.text, mail.html]) {
      expect(part).not.toContain("—");
      expect(part).not.toContain("–");
    }
  });

  it("escapes the link inside the html attribute", () => {
    const mail = buildPasswordResetEmail({
      to: "ana@ejemplo.com",
      url: 'https://x.test/r?a=1&b="2"><script>',
    });
    expect(mail.html).not.toContain("<script>");
    expect(mail.html).toContain("a=1&amp;b=&quot;2&quot;&gt;&lt;script&gt;");
    // El texto plano lleva el enlace tal cual, sin escapar.
    expect(mail.text).toContain('https://x.test/r?a=1&b="2"><script>');
  });

  it("states the token lifetime the auth config actually uses", () => {
    expect(RESET_TOKEN_TTL_SECONDS).toBe(3600);
    const short = buildPasswordResetEmail({ to: "a@b.co", url: URL_RESET, ttlSeconds: 1800 });
    expect(short.text).toContain("El enlace vale 30 minutos");
  });
});

describe("sendPasswordResetEmail", () => {
  it("sends one email through the connector", async () => {
    await sendPasswordResetEmail({ to: "ana@ejemplo.com", url: URL_RESET });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.to).toEqual(["ana@ejemplo.com"]);
    expect(body.text).toContain(URL_RESET);
  });

  it("stops after the per-address limit, whatever the casing, without throwing", async () => {
    for (let i = 0; i < RESET_EMAIL_LIMIT.max + 2; i += 1) {
      await expect(
        sendPasswordResetEmail({ to: i % 2 ? "ANA@ejemplo.com" : " ana@ejemplo.com ", url: URL_RESET }),
      ).resolves.toBeUndefined();
    }
    expect(fetchMock).toHaveBeenCalledTimes(RESET_EMAIL_LIMIT.max);
    // Otra dirección no comparte el tope.
    await sendPasswordResetEmail({ to: "luis@ejemplo.com", url: URL_RESET });
    expect(fetchMock).toHaveBeenCalledTimes(RESET_EMAIL_LIMIT.max + 1);
  });

  it("never throws when the provider fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    fetchMock.mockRejectedValue(new Error("boom"));
    await expect(sendPasswordResetEmail({ to: "ana@ejemplo.com", url: URL_RESET })).resolves.toBeUndefined();
  });
});

// Importa todo el auth (Better Auth + Drizzle) en frío: con la máquina cargada pasa de los 5 s por defecto.
describe("Better Auth wiring", { timeout: 30_000 }, () => {
  type AuthOptions = {
    emailAndPassword: {
      sendResetPassword?: (data: { user: { email: string }; url: string }) => Promise<void>;
      resetPasswordTokenExpiresIn?: number;
      revokeSessionsOnPasswordReset?: boolean;
    };
    hooks: { before: (ctx: unknown) => Promise<unknown> };
  };

  async function loadAuth(): Promise<AuthOptions> {
    vi.resetModules();
    vi.doMock("better-auth", () => ({ betterAuth: (options: unknown) => options }));
    delete (globalThis as { __voceroAuth?: unknown }).__voceroAuth;
    vi.stubEnv("APP_BASE_URL", "http://localhost:3414");
    vi.stubEnv("DATABASE_URL", "postgresql://u:p@127.0.0.1:1/none");
    vi.stubEnv("BETTER_AUTH_SECRET", "test-secret-test-secret-1234");
    vi.stubEnv("ENCRYPTION_KEY", Buffer.alloc(32).toString("base64"));
    vi.stubEnv("META_WEBHOOK_VERIFY_TOKEN", "verify-token-1234");
    vi.stubEnv("ALLOK_SAAS_MODE", "");
    vi.stubEnv("WA_MOCK_ENABLED", "");
    resetEnvCacheForTests();
    const { getAuth } = await import("@/lib/auth");
    return getAuth() as unknown as AuthOptions;
  }

  afterEach(() => {
    vi.doUnmock("better-auth");
    delete (globalThis as { __voceroAuth?: unknown }).__voceroAuth;
    resetEnvCacheForTests();
  });

  it("does not expose the reset flow while the connector is off", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("EMAIL_FROM", "");
    const auth = await loadAuth();
    expect(auth.emailAndPassword.sendResetPassword).toBeUndefined();
  });

  it("exposes it with a 1 hour token and session revocation when the connector is on", async () => {
    const auth = await loadAuth();
    expect(auth.emailAndPassword.sendResetPassword).toBeTypeOf("function");
    expect(auth.emailAndPassword.resetPasswordTokenExpiresIn).toBe(RESET_TOKEN_TTL_SECONDS);
    expect(auth.emailAndPassword.revokeSessionsOnPasswordReset).toBe(true);
  });

  it("returns before the email is sent, so an existing account answers as fast as an unknown one", async () => {
    fetchMock.mockReturnValue(new Promise(() => {})); // el proveedor nunca contesta
    const auth = await loadAuth();
    await expect(
      auth.emailAndPassword.sendResetPassword!({ user: { email: "ana@ejemplo.com" }, url: URL_RESET }),
    ).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rate limits the reset endpoints per IP, like login", async () => {
    const auth = await loadAuth();
    const call = (path: string, ip: string) =>
      auth.hooks.before({ path, headers: new Headers({ "x-forwarded-for": ip }) });

    for (let i = 0; i < 10; i += 1) await call("/request-password-reset", "203.0.113.7");
    await expect(call("/request-password-reset", "203.0.113.7")).rejects.toMatchObject({
      status: "TOO_MANY_REQUESTS",
    });
    // Otra IP y el otro endpoint llevan su propia cuenta.
    await expect(call("/request-password-reset", "203.0.113.8")).resolves.not.toThrow();
    await expect(call("/reset-password", "203.0.113.7")).resolves.not.toThrow();
  });
});

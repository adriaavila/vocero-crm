import { describe, expect, it } from "vitest";
import {
  buildClearStateCookieHeader,
  buildStateCookieHeader,
  createSignupState,
  readStateCookie,
  SIGNUP_STATE_COOKIE,
  SIGNUP_STATE_COOKIE_PATH,
  verifySignupState,
} from "@/server/agencia/whatsapp-signup/state";

/** Estado firmado de Embedded Signup en la app (fork): sign/verify/expiry/tamper. */

const SECRET = "un-secreto-de-app-suficientemente-largo";
const input = { orgId: "org_1", userId: "user_1", mode: "coexistence" as const };

describe("createSignupState / verifySignupState", () => {
  it("firma y verifica un estado válido", () => {
    const state = createSignupState(input, SECRET);
    expect(state).toBeTruthy();
    const context = verifySignupState(state, SECRET);
    expect(context?.orgId).toBe("org_1");
    expect(context?.userId).toBe("user_1");
    expect(context?.mode).toBe("coexistence");
    expect(typeof context?.nonce).toBe("string");
  });

  it("sin secreto no firma nada", () => {
    expect(createSignupState(input, undefined)).toBeNull();
  });

  it("rechaza sin secreto configurado al verificar", () => {
    const state = createSignupState(input, SECRET);
    expect(verifySignupState(state, undefined)).toBeNull();
  });

  it("rechaza con la clave equivocada (firma no coincide)", () => {
    const state = createSignupState(input, SECRET);
    expect(verifySignupState(state, "otra-clave-larga-cualquiera")).toBeNull();
  });

  it("rechaza manipulación del payload (tamper): cambiar el orgId invalida la firma", () => {
    const state = createSignupState(input, SECRET)!;
    const [payload, signature] = state.split(".");
    const tampered = JSON.parse(Buffer.from(payload!, "base64url").toString("utf8"));
    tampered.orgId = "org_ajeno";
    const tamperedPayload = Buffer.from(JSON.stringify(tampered)).toString("base64url");
    expect(verifySignupState(`${tamperedPayload}.${signature}`, SECRET)).toBeNull();
  });

  it("rechaza un valor con forma inválida (sin punto, partes extra)", () => {
    expect(verifySignupState("sin-punto", SECRET)).toBeNull();
    expect(verifySignupState("a.b.c", SECRET)).toBeNull();
    expect(verifySignupState(undefined, SECRET)).toBeNull();
    expect(verifySignupState(null, SECRET)).toBeNull();
  });

  it("expira pasados los 15 minutos", () => {
    const now = Date.now();
    const state = createSignupState(input, SECRET, now);
    // Justo antes de expirar: válido.
    expect(verifySignupState(state, SECRET, now + 14 * 60 * 1000)).not.toBeNull();
    // Pasados los 15 minutos: inválido.
    expect(verifySignupState(state, SECRET, now + 16 * 60 * 1000)).toBeNull();
  });

  it("rechaza un mode fuera del enum, aunque la firma sea válida", () => {
    // Bypass de tipos a propósito: la firma real de createSignupState solo
    // acepta el enum, así que esto prueba la VALIDACIÓN en verifySignupState,
    // no algo alcanzable por el flujo normal.
    const state = createSignupState(
      { ...input, mode: "otro_modo" as unknown as typeof input.mode },
      SECRET
    );
    expect(verifySignupState(state, SECRET)).toBeNull();
  });
});

describe("cookie del estado", () => {
  it("build/read: la cookie construida se puede releer del header Cookie", () => {
    const header = buildStateCookieHeader("valor-de-estado");
    expect(header).toContain(`${SIGNUP_STATE_COOKIE}=valor-de-estado`);
    expect(header).toContain(`Path=${SIGNUP_STATE_COOKIE_PATH}`);
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Lax");
    // El header Set-Cookie no es el mismo formato que Cookie, pero el nombre=valor
    // inicial sí, que es lo que manda el navegador de vuelta.
    const cookieHeader = header.split(";")[0];
    expect(readStateCookie(cookieHeader!)).toBe("valor-de-estado");
  });

  it("ignora otras cookies y encuentra la correcta entre varias", () => {
    const cookieHeader = `otra=1; ${SIGNUP_STATE_COOKIE}=abc123; tercera=2`;
    expect(readStateCookie(cookieHeader)).toBe("abc123");
  });

  it("sin la cookie, o sin header, devuelve null", () => {
    expect(readStateCookie("otra=1")).toBeNull();
    expect(readStateCookie(null)).toBeNull();
  });

  it("la cookie de limpieza vence de inmediato (Max-Age=0)", () => {
    expect(buildClearStateCookieHeader()).toContain("Max-Age=0");
  });
});

import { describe, expect, it } from "vitest";
import { REGISTER_MESSAGES, registerFailure } from "@/lib/auth/register-error";

describe("registerFailure", () => {
  it("un correo con cuenta pide iniciar sesión, en español", () => {
    for (const error of [
      { status: 422, code: "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL", message: "User already exists. Use another email." },
      { status: 422, code: "USER_ALREADY_EXISTS", message: "User already exists." },
      { status: 422, message: "User already exists. Use another email." },
    ]) {
      expect(registerFailure(error)).toEqual({ message: "Ya hay una cuenta con este correo.", existingAccount: true });
    }
  });

  it("traduce contraseña corta, larga y correo inválido", () => {
    expect(registerFailure({ status: 400, code: "PASSWORD_TOO_SHORT", message: "Password too short" })).toEqual({
      message: REGISTER_MESSAGES.passwordShort,
      existingAccount: false,
    });
    expect(registerFailure({ status: 400, code: "PASSWORD_TOO_LONG" }).message).toBe(REGISTER_MESSAGES.passwordLong);
    expect(registerFailure({ status: 400, code: "INVALID_PASSWORD" }).message).toBe(REGISTER_MESSAGES.passwordInvalid);
    expect(registerFailure({ status: 400, code: "INVALID_EMAIL", message: "Invalid email" }).message).toBe(REGISTER_MESSAGES.email);
  });

  it("demasiados intentos y red caída tienen su frase", () => {
    expect(registerFailure({ status: 429, message: "Demasiados intentos; espera unos minutos" }).message).toBe(REGISTER_MESSAGES.rateLimited);
    expect(registerFailure({ status: 0 }).message).toBe(REGISTER_MESSAGES.network);
    expect(registerFailure(new TypeError("Failed to fetch") as never).message).toBe(REGISTER_MESSAGES.network);
  });

  it("403: conserva el aviso de otro host y cierra lo demás", () => {
    expect(registerFailure({ status: 403, message: "El registro de allok empieza en app.allok.fun" }).message).toBe(
      "El registro de allok empieza en app.allok.fun",
    );
    expect(registerFailure({ status: 403, message: "Forbidden" }).message).toBe(REGISTER_MESSAGES.closed);
  });

  it("nunca deja pasar un mensaje en inglés que no reconoce", () => {
    const failure = registerFailure({ status: 500, code: "FAILED_TO_CREATE_USER", message: "Failed to create user" });
    expect(failure).toEqual({ message: REGISTER_MESSAGES.generic, existingAccount: false });
    expect(registerFailure(null).message).toBe(REGISTER_MESSAGES.generic);
  });
});

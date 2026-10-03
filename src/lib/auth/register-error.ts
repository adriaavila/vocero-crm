/**
 * Lo que Better Auth contesta al registrarse, en palabras del dueño.
 *
 * Better Auth devuelve sus mensajes en inglés ("User already exists. Use
 * another email."). El formulario nunca los muestra tal cual: cada código
 * conocido tiene su frase, y lo que no se reconoce cae en una genérica que sí
 * dice qué hacer. Puro y sin servidor: el formulario (cliente) lo importa.
 */

export type RegisterErrorInput = {
  status?: number;
  code?: string;
  message?: string;
} | null | undefined;

export type RegisterFailure = {
  message: string;
  /** El correo ya tiene cuenta: el formulario ofrece iniciar sesión. */
  existingAccount: boolean;
};

const ALREADY_EXISTS = new Set(["USER_ALREADY_EXISTS", "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL"]);

export const REGISTER_MESSAGES = {
  existingAccount: "Ya hay una cuenta con este correo.",
  passwordShort: "La contraseña necesita al menos 8 caracteres.",
  passwordLong: "La contraseña es demasiado larga. Usa menos de 128 caracteres.",
  passwordInvalid: "Esa contraseña no se puede usar. Prueba con otra de al menos 8 caracteres.",
  email: "Revisa el correo: no parece válido.",
  rateLimited: "Demasiados intentos. Espera unos minutos y vuelve a intentarlo.",
  network: "No pudimos conectar. Revisa tu internet y vuelve a intentarlo.",
  closed: "El registro está cerrado: esta instancia ya tiene su organización. Pide acceso al propietario.",
  generic: "No pudimos crear tu cuenta. Inténtalo de nuevo en un momento.",
} as const;

/** El error de red de `fetch` (sin respuesta del servidor), o un estado 0. */
export function isNetworkError(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  if (!error || typeof error !== "object") return false;
  const status = (error as { status?: unknown }).status;
  return status === 0;
}

export function registerFailure(error: RegisterErrorInput): RegisterFailure {
  const code = error?.code ?? "";
  const message = error?.message ?? "";
  const failure = (text: string, existingAccount = false): RegisterFailure => ({ message: text, existingAccount });

  if (ALREADY_EXISTS.has(code) || /already exists/i.test(message)) {
    return failure(REGISTER_MESSAGES.existingAccount, true);
  }
  if (code === "PASSWORD_TOO_SHORT" || /password too short/i.test(message)) {
    return failure(REGISTER_MESSAGES.passwordShort);
  }
  if (code === "PASSWORD_TOO_LONG" || /password too long/i.test(message)) {
    return failure(REGISTER_MESSAGES.passwordLong);
  }
  if (code === "INVALID_PASSWORD") return failure(REGISTER_MESSAGES.passwordInvalid);
  if (code === "INVALID_EMAIL" || /invalid email/i.test(message)) return failure(REGISTER_MESSAGES.email);
  if (error?.status === 429) return failure(REGISTER_MESSAGES.rateLimited);
  if (error?.status === 403) {
    // El prefijo es estable entre marcas (ver lib/auth/index.ts): el nombre de
    // marca va DESPUÉS, y el cliente no puede leer `BRAND` (no es
    // NEXT_PUBLIC_) para reconstruirlo él mismo.
    return failure(message.startsWith("El registro de ") ? message : REGISTER_MESSAGES.closed);
  }
  if (isNetworkError(error)) return failure(REGISTER_MESSAGES.network);
  return failure(REGISTER_MESSAGES.generic);
}

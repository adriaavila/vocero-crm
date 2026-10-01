/**
 * Copys fijos por paso (fork) — NUNCA el texto crudo de Meta hacia el
 * cliente. El motivo real de Meta se loguea server-side (console.error en
 * complete.ts); lo que ve el dueño es esto.
 */

export type SignupStep =
  | "config"
  | "body"
  | "state"
  | "session"
  | "membership"
  | "rate_limited"
  | "exchange"
  | "debug_token"
  | "permissions"
  | "resolve"
  | "phone_in_use"
  | "webhook"
  | "webhook_verify"
  | "register"
  | "register_pin_mismatch"
  | "register_not_verified"
  | "register_limit"
  | "waba_in_use";

const COPY: Record<SignupStep, string> = {
  config: "La conexión de WhatsApp en la app no está configurada.",
  body: "El cuerpo debe ser JSON válido.",
  state: "Tu sesión de conexión expiró o no coincide. Vuelve a intentar.",
  session: "Tu sesión expiró. Vuelve a iniciar sesión e intenta de nuevo.",
  membership: "Ya no eres propietario de este negocio.",
  rate_limited: "Demasiados intentos. Espera unos minutos y vuelve a intentar.",
  exchange: "Meta no pudo procesar la autorización. Vuelve a intentar.",
  debug_token: "Meta no pudo validar la conexión. Vuelve a intentar.",
  permissions: "Falta autorizar permisos de WhatsApp en Meta.",
  resolve: "No pudimos identificar un único número de WhatsApp para conectar.",
  phone_in_use: "Ese número ya está conectado a otra cuenta de allok. Escríbenos y lo movemos a tu cuenta.",
  waba_in_use: "Ese número ya está conectado a otra cuenta de allok. Escríbenos y lo movemos a tu cuenta.",
  webhook: "Meta rechazó el enlace de mensajes. Vuelve a intentar.",
  webhook_verify: "Meta no confirmó el enlace de mensajes. Vuelve a intentar.",
  register: "Meta rechazó el alta del número. Vuelve a intentar.",
  register_pin_mismatch:
    "Tu número tiene un PIN de verificación en dos pasos. Desactívalo en WhatsApp Manager y vuelve a intentar.",
  register_not_verified: "Meta todavía no verificó tu número. Termina la verificación y vuelve a intentar.",
  register_limit: "Meta frenó los intentos con este número por ahora. Espera unas horas y vuelve a intentar.",
};

const FALLBACK = "No pudimos completar la conexión con Meta. Vuelve a intentar.";

export function copyForStep(step: string): string {
  return (COPY as Record<string, string>)[step] ?? FALLBACK;
}

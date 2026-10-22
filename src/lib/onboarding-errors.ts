/**
 * Errores del alta de WhatsApp en lenguaje humano. Lo usan el servidor (pasos
 * del alta) y el navegador (errores que Meta reporta dentro de su ventana), así
 * que no importa nada del servidor. El texto crudo de Meta nunca llega al dueño:
 * se guarda en `whatsapp_onboarding.error_detail` para soporte.
 */

export const META_PAYMENT_URL = "https://business.facebook.com/wa/manage/home/";
export const WHATSAPP_MANAGER_URL = "https://business.facebook.com/wa/manage/phone-numbers/";

export type OnboardingErrorKey =
  | "cancelled"
  | "number_on_whatsapp"
  | "other_provider"
  | "waba_shared"
  | "coexistence_region"
  | "coexistence_not_eligible"
  | "number_in_use"
  | "no_number_selected"
  | "permissions"
  | "register_not_verified"
  | "register_pin_mismatch"
  | "register_limit"
  | "webhook"
  | "meta_unavailable"
  | "meta_blocked"
  | "session_expired";

export type OnboardingErrorCopy = {
  title: string;
  body: string;
  action?: { label: string; href: string };
  /** true cuando reintentar sin cambiar nada puede funcionar. */
  retry: boolean;
};

/**
 * La marca del despliegue, resuelta en el servidor y bajada por prop: este
 * módulo corre también en el navegador, donde `brand()` no ve `BRAND`. Sin
 * ella el texto no nombra ninguna marca y no ofrece un soporte que no sabe.
 */
export type OnboardingBrand = {
  /** "allok" / "Rei". */
  brandName?: string | null;
  /** Adonde escribe el dueño para pedir ayuda (`helpUrl()`); null si la marca no tiene contacto. */
  supportHref?: string | null;
};

function copyFor({ brandName, supportHref }: OnboardingBrand): Record<OnboardingErrorKey, OnboardingErrorCopy> {
  const ofBrand = brandName ? ` de ${brandName}` : "";
  return {
    // En coexistencia, WhatsApp Business ya dice «conectado» cuando el dueño
    // confirma en el teléfono, pero el número solo nos llega con «Finalizar».
    // Si cerró ahí, lo seguro es desconectar en la app antes de reintentar.
    cancelled: {
      title: "Falta terminar en la ventana de Meta",
      body: `Se cerró antes de tocar «Finalizar», así que tu número no llegó${brandName ? ` a ${brandName}` : " hasta aquí"}. Si tu WhatsApp Business ya dice que está conectado, desconéctalo ahí (Ajustes > Cuenta > Plataforma empresarial), espera unos minutos y vuelve a conectar.`,
      retry: true,
    },
    number_on_whatsapp: {
      title: "Ese número ya está en WhatsApp",
      body:
        "Para seguir usándolo en tu teléfono, elige la opción de mantener tu app de WhatsApp Business. Si prefieres, conecta un número nuevo.",
      retry: true,
    },
    other_provider: {
      title: "Ese número está con otro proveedor",
      body:
        "En la app de WhatsApp Business ve a Ajustes > Cuenta > Plataforma empresarial, desconéctalo y vuelve a intentar en 15 minutos.",
      retry: true,
    },
    waba_shared: {
      title: "Tu cuenta de WhatsApp está compartida con otro proveedor",
      body: "Quítale el acceso a ese proveedor desde Meta, o crea una cuenta nueva dentro de la ventana de conexión.",
      retry: true,
    },
    coexistence_region: {
      title: "Mantener la app aún no está disponible en tu país",
      body: `Conecta un número nuevo para usar${brandName ? ` ${brandName}` : "lo"} con WhatsApp.`,
      retry: false,
    },
    coexistence_not_eligible: {
      title: "Tu número todavía no puede seguir en la app",
      body: "Úsalo unos días más en WhatsApp Business y vuelve a intentar, o conecta un número nuevo.",
      retry: false,
    },
    number_in_use: {
      title: `Ese número ya está conectado a otra cuenta${ofBrand}`,
      body: supportHref ? "Escríbenos y lo movemos a tu cuenta." : "Si es tuyo, desconéctalo de la otra cuenta o conecta un número nuevo.",
      ...(supportHref ? { action: { label: "Escribir a soporte", href: supportHref } } : {}),
      retry: false,
    },
    no_number_selected: {
      title: "No elegiste un número",
      body: "Vuelve a abrir la conexión y elige o agrega el número de WhatsApp de tu negocio.",
      retry: true,
    },
    permissions: {
      title: "Faltan permisos de WhatsApp",
      body: "Vuelve a abrir la conexión y deja marcados todos los permisos que pide Meta.",
      retry: true,
    },
    register_not_verified: {
      title: "Meta todavía no verificó tu número",
      body: "Termina la verificación por SMS o llamada en la ventana de Meta y vuelve a intentar.",
      retry: true,
    },
    register_pin_mismatch: {
      title: "Tu número tiene un PIN de verificación en dos pasos",
      body:
        "Desactívalo en WhatsApp Manager (número > Verificación en dos pasos) y vuelve a intentar. Después puedes activarlo otra vez.",
      action: { label: "Abrir WhatsApp Manager", href: WHATSAPP_MANAGER_URL },
      retry: true,
    },
    register_limit: {
      title: "Meta frenó los intentos por ahora",
      body: "Se hicieron demasiados intentos con este número. Espera unas horas y vuelve a intentar.",
      retry: true,
    },
    webhook: {
      title: "Meta no confirmó la recepción de mensajes",
      body: "Tu número ya quedó guardado. Toca reintentar y terminamos de activarlo.",
      retry: true,
    },
    meta_unavailable: {
      title: "Meta no respondió",
      body: "Puede ser algo pasajero de Meta. Vuelve a intentar en un momento.",
      retry: true,
    },
    // Fork (agencia): el SDK de Meta no cargó en este navegador (bloqueador o
    // navegador de Instagram/Facebook). Lo pone el puente, nunca el servidor.
    meta_blocked: {
      title: "Tu navegador no abrió la ventana de Meta",
      body: "Pasa con los bloqueadores de anuncios y dentro de Instagram o Facebook. Copia el enlace y ábrelo en Chrome o Safari, o pausa el bloqueador y reintenta.",
      retry: true,
    },
    session_expired: {
      title: "Tu sesión expiró",
      body: "Vuelve a iniciar sesión e intenta de nuevo.",
      retry: true,
    },
  };
}

const KEYS = copyFor({});

export function onboardingErrorCopy(key: string | null | undefined, brand: OnboardingBrand = {}): OnboardingErrorCopy {
  const copy = copyFor(brand);
  return (key && key in copy ? copy[key as OnboardingErrorKey] : null) ?? copy.meta_unavailable;
}

/**
 * Códigos que Meta manda dentro de su ventana (evento CANCEL con
 * `error_code`). Fuente: documentación de errores de Embedded Signup.
 */
const IN_FLOW_CODES: Record<string, OnboardingErrorKey> = {
  "3441030": "number_on_whatsapp",
  "2655093": "other_provider",
  "3441049": "other_provider",
  "2655094": "other_provider",
  "2655049": "waba_shared",
  "2494028": "waba_shared",
  "3441042": "coexistence_region",
  "3441045": "coexistence_not_eligible",
};

/** Evento CANCEL del SDK → clave humana. Sin código es un cierre del dueño. */
export function errorKeyForCancel(errorCode: unknown): OnboardingErrorKey {
  const code = errorCode == null ? "" : String(errorCode).trim();
  if (!code) return "cancelled";
  return IN_FLOW_CODES[code] ?? "meta_unavailable";
}

/**
 * Paso del alta (servidor) → clave humana. Los pasos vienen de
 * `whatsapp-signup/complete.ts`.
 */
export function errorKeyForStep(step: string | null | undefined): OnboardingErrorKey {
  switch (step) {
    case "state":
    case "session":
    case "membership":
      return "session_expired";
    case "permissions":
      return "permissions";
    case "resolve":
      return "no_number_selected";
    case "phone_in_use":
    case "waba_in_use":
      return "number_in_use";
    case "webhook":
    case "webhook_verify":
      return "webhook";
    case "register_pin_mismatch":
      return "register_pin_mismatch";
    case "register_not_verified":
      return "register_not_verified";
    case "register_limit":
      return "register_limit";
    default:
      // Errores que vienen de la ventana de Meta ya se guardan con su clave.
      return step && step in KEYS ? (step as OnboardingErrorKey) : "meta_unavailable";
  }
}

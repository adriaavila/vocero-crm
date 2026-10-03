import { brand } from "@/lib/brand";
import { checkRateLimit } from "@/lib/rate-limit";
import { sendEmail, type EmailMessage } from "./email";

/**
 * "Olvidé mi contraseña" (capa de agencia). Better Auth pone el token, el
 * enlace y los endpoints; aquí vive lo que es nuestro: el texto del correo, el
 * límite por correo y el envío sin esperar. Se monta en `lib/auth/index.ts`
 * con una sola referencia, solo cuando el conector de correo está encendido.
 */

/** Cuánto vive el enlace. Pasado ese tiempo la pantalla pide uno nuevo. */
export const RESET_TOKEN_TTL_SECONDS = 60 * 60;

/**
 * Tope de correos de restablecimiento POR CORREO destino: sin él, alguien
 * podría llenar la bandeja de otra persona usando IPs distintas. El tope por
 * IP (AUTH_RATE_LIMIT) lo pone el gate de `lib/auth/index.ts`.
 */
export const RESET_EMAIL_LIMIT = { windowMs: 60 * 60 * 1000, max: 3 };

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function ttlLabel(seconds: number): string {
  const hours = Math.round(seconds / 3600);
  if (seconds % 3600 === 0 && hours >= 1) return hours === 1 ? "1 hora" : `${hours} horas`;
  return `${Math.max(1, Math.round(seconds / 60))} minutos`;
}

/** Texto plano y HTML mínimo. Sin el nombre de la cuenta: allí va el del negocio. */
export function buildPasswordResetEmail(input: {
  to: string;
  url: string;
  brandName?: string;
  ttlSeconds?: number;
}): EmailMessage {
  const name = input.brandName ?? brand().name;
  const ttl = ttlLabel(input.ttlSeconds ?? RESET_TOKEN_TTL_SECONDS);
  const subject = `Restablece tu contraseña de ${name}`;
  const text = [
    "Hola,",
    "",
    `Pediste restablecer tu contraseña de ${name}. Abre este enlace para elegir una nueva:`,
    "",
    input.url,
    "",
    `El enlace vale ${ttl} y se usa una sola vez.`,
    "Si no fuiste tú, ignora este correo: tu contraseña sigue igual.",
    "",
    name,
  ].join("\n");
  const href = escapeHtml(input.url);
  const html = [
    '<div style="font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Helvetica,Arial,sans-serif;color:#0b0d0e;max-width:480px;margin:0 auto;padding:24px;line-height:1.5">',
    "<p>Hola,</p>",
    `<p>Pediste restablecer tu contraseña de ${escapeHtml(name)}. Elige una nueva con este botón:</p>`,
    `<p style="margin:24px 0"><a href="${href}" style="background:#0b0d0e;color:#f7f8f8;text-decoration:none;padding:12px 20px;border-radius:10px;display:inline-block;font-weight:600">Elegir contraseña nueva</a></p>`,
    `<p style="font-size:13px;color:#5b6167">¿No abre el botón? Copia este enlace en tu navegador:<br><a href="${href}" style="color:#5b6167;word-break:break-all">${href}</a></p>`,
    `<p style="font-size:13px;color:#5b6167">El enlace vale ${ttl} y se usa una sola vez. Si no fuiste tú, ignora este correo: tu contraseña sigue igual.</p>`,
    "</div>",
  ].join("");
  return { to: input.to, subject, text, html };
}

/**
 * Manda el correo del enlace. Nunca lanza y nunca se espera desde la petición
 * (ver `sendResetPassword` en `lib/auth/index.ts`): que la respuesta tarde lo
 * mismo exista o no la cuenta es lo que impide adivinar correos por tiempo.
 * Pasado el tope por correo, se descarta en silencio por la misma razón.
 */
export async function sendPasswordResetEmail(input: { to: string; url: string }): Promise<void> {
  try {
    const key = `reset-email:${input.to.trim().toLowerCase()}`;
    if (!checkRateLimit(key, RESET_EMAIL_LIMIT).allowed) return;
    await sendEmail(buildPasswordResetEmail(input));
  } catch {
    // El correo es un extra: su fallo no cambia la respuesta de la petición.
  }
}

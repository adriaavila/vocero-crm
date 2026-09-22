/**
 * Correo transaccional — conector OPCIONAL (Constitución II, patrón ADR-001).
 *
 * Encendido solo si hay `RESEND_API_KEY` y `EMAIL_FROM`. Apagado, cada envío
 * es un no-op que devuelve false y el CRM funciona igual: la recuperación de
 * contraseña vuelve a ser `scripts/reset-password.mjs`. Un fallo de Resend
 * jamás propaga: se loguea sin el destinatario ni el contenido.
 *
 * ponytail: un POST a la API de Resend, sin su SDK; añadirlo solo si hacen
 * falta adjuntos o plantillas del lado de Resend.
 */

const RESEND_URL = "https://api.resend.com/emails";

export function emailEnabled(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim() && process.env.EMAIL_FROM?.trim());
}

export type Email = { to: string; subject: string; text: string };

export async function sendEmail(email: Email): Promise<boolean> {
  if (!emailEnabled()) return false;
  try {
    const res = await fetch(RESEND_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY!.trim()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM!.trim(),
        to: [email.to],
        subject: email.subject,
        text: email.text,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      console.error(`[correo] Resend respondió ${res.status}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`[correo] envío fallido: ${err instanceof Error ? err.name : "error"}`);
    return false;
  }
}

export function resetPasswordEmail(to: string, url: string): Email {
  return {
    to,
    subject: "Restablece tu contraseña de Allok",
    text: [
      "Alguien pidió restablecer la contraseña de tu cuenta de Allok.",
      "",
      `Para elegir una nueva, abre este enlace (vale 1 hora):`,
      url,
      "",
      "Si no fuiste tú, ignora este correo: tu contraseña no cambia.",
    ].join("\n"),
  };
}

export function verifyEmailEmail(to: string, url: string): Email {
  return {
    to,
    subject: "Confirma tu correo en Allok",
    text: [
      "Confirma que este correo es tuyo para no perder el acceso a tu cuenta:",
      url,
      "",
      "Si no creaste una cuenta en Allok, ignora este correo.",
    ].join("\n"),
  };
}

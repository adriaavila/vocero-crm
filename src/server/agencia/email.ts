/**
 * Conector opcional de correo (Resend). Capa de agencia.
 *
 * El núcleo no manda correo: la constitución (II) deja los terceros como
 * conectores APAGADOS por defecto. Este lo enciende el operador del
 * despliegue con dos variables, no cada negocio:
 *
 *   RESEND_API_KEY  → resend.com → API Keys (permiso "Sending access")
 *   EMAIL_FROM      → remitente de un dominio verificado en Resend,
 *                     p. ej.  allok <no-reply@allok.fun>
 *   EMAIL_API_URL   → opcional: otro endpoint (sumidero de desarrollo)
 *
 * Sin las dos, `isEmailConfigured()` es false y nada de aquí hace red. Quien
 * lo use (hoy, "olvidé mi contraseña") decide su camino sin correo.
 *
 * Es un `fetch` directo a la API de Resend: sin SDK, sin dependencia nueva.
 * `sendEmail` NUNCA lanza: un fallo del proveedor jamás debe tumbar la
 * operación que lo pidió. Tampoco escribe en logs la llave, el destinatario ni
 * el cuerpo (el cuerpo de un reset lleva el token en el enlace).
 */

const RESEND_ENDPOINT = "https://api.resend.com/emails";

/**
 * `EMAIL_API_URL` reemplaza el endpoint (mismo formato que Resend). En local
 * apunta al sumidero `/api/dev/email-sink`, que guarda el correo en memoria en
 * vez de enviarlo: así el guion de autoservicio y los servidores de desarrollo
 * nunca escriben a un correo real.
 */
function endpoint(): string {
  return process.env.EMAIL_API_URL?.trim() || RESEND_ENDPOINT;
}
const SEND_TIMEOUT_MS = 8_000;

export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

export type EmailResult =
  | { ok: true; id: string | null }
  | { ok: false; reason: "disabled" | "rejected" | "unreachable"; status?: number };

function apiKey(): string | null {
  return process.env.RESEND_API_KEY?.trim() || null;
}

function sender(): string | null {
  return process.env.EMAIL_FROM?.trim() || null;
}

/** true solo con `RESEND_API_KEY` y `EMAIL_FROM`. Leídas de `process.env` en cada llamada. */
export function isEmailConfigured(): boolean {
  return Boolean(apiKey() && sender());
}

export async function sendEmail(message: EmailMessage): Promise<EmailResult> {
  const key = apiKey();
  const from = sender();
  if (!key || !from) return { ok: false, reason: "disabled" };

  let response: Response;
  try {
    response = await fetch(endpoint(), {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
        "user-agent": "vocero-crm",
      },
      body: JSON.stringify({
        from,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        html: message.html,
      }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
  } catch {
    console.error("[email] resend unreachable");
    return { ok: false, reason: "unreachable" };
  }

  if (!response.ok) {
    // Solo el tipo de error que declara Resend (p. ej. "validation_error"):
    // su `message` puede traer el destinatario.
    const payload = (await response.json().catch(() => null)) as { name?: unknown } | null;
    const kind = typeof payload?.name === "string" ? payload.name : "unknown";
    console.error(`[email] resend rejected status=${response.status} kind=${kind}`);
    return { ok: false, reason: "rejected", status: response.status };
  }

  const payload = (await response.json().catch(() => null)) as { id?: unknown } | null;
  return { ok: true, id: typeof payload?.id === "string" ? payload.id : null };
}

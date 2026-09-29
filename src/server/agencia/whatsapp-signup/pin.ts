import { createHmac } from "node:crypto";

/**
 * PIN de verificación en dos pasos para `POST {phone}/register` (modo Cloud
 * API). allok.fun genera uno aleatorio y lo guarda cifrado en una tabla nueva;
 * aquí no hay tabla nueva que agregar (fork: menor superficie posible), así
 * que el PIN sale DETERMINISTA de un secreto que ya existe — mismo
 * phoneNumberId, siempre el mismo PIN, sin guardar nada.
 *
 * HMAC-SHA256(ENCRYPTION_KEY, "wa-register-pin:" + phoneNumberId) → primeros
 * 4 bytes como entero sin signo → módulo 1e6 → 6 dígitos con ceros a la
 * izquierda. Nunca se loguea (constitución I: secretos jamás a logs).
 */
export function deriveRegistrationPin(
  phoneNumberId: string,
  encryptionKeyBase64: string,
): string {
  const key = Buffer.from(encryptionKeyBase64, "base64");
  const digest = createHmac("sha256", key)
    .update(`wa-register-pin:${phoneNumberId}`)
    .digest();
  const n = digest.readUInt32BE(0) % 1_000_000;
  return String(n).padStart(6, "0");
}

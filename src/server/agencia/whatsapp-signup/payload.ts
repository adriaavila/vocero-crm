import { z } from "zod";

/** Contrato de `POST /api/whatsapp/embedded-signup/complete`. */
export const completeSignupSchema = z.object({
  code: z.string().trim().min(1),
  state: z.string().trim().min(1),
  wabaId: z.string().trim().min(1).optional(),
  phoneNumberId: z.string().trim().min(1).optional(),
  businessId: z.string().trim().min(1).optional(),
  mode: z.enum(["coexistence", "cloud_api"]),
  // Info de la sesión del SDK (session_id, current_step…): informativa, nunca
  // secreta, nunca se usa para decidir nada. Se acepta como objeto libre para
  // no romper si Meta agrega campos.
  event: z.record(z.string(), z.unknown()).optional(),
});

export type CompleteSignupPayload = z.infer<typeof completeSignupSchema>;

/** Postgres (driver `postgres`): unique_violation trae este código. */
const UNIQUE_VIOLATION = "23505";

/**
 * `meta_credentials_phone_uq` es de INSTANCIA: un número no puede estar en
 * dos organizaciones a la vez. `saveCredentials` solo resuelve conflicto por
 * `organization_id` (upsert), así que un choque en el índice del teléfono
 * llega crudo desde Postgres — esto lo traduce a algo que la UI puede mostrar
 * en vez de un 500 mudo.
 */
export function isDuplicatePhoneNumberError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const value = err as { code?: unknown; constraint_name?: unknown };
  return value.code === UNIQUE_VIOLATION && value.constraint_name === "meta_credentials_phone_uq";
}

import { timingSafeEqual } from "node:crypto";

/**
 * Provisión entrante desde allok (contrato de `handover/provision.ts`).
 *
 * allok conecta el número por Embedded Signup y, antes de mover el webhook en
 * Meta, empuja aquí las credenciales de ese número. El orden no es negociable:
 * primero las credenciales, después el webhook. Si el webhook se redirige antes,
 * los mensajes llegan a una instancia que todavía no conoce ese número.
 *
 * Este módulo es puro a propósito — sin DB, sin env — para que el contrato se
 * pueda probar sin levantar Postgres.
 */

export type ProvisionPayload = {
  organizationId: string | null;
  wabaId: string;
  phoneNumberId: string;
  token: string;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  connectionMode: "META_CLOUD_API" | "META_COEXISTENCE";
};

export type ParseResult =
  | { ok: true; payload: ProvisionPayload }
  | { ok: false; message: string };

const MODES = ["META_CLOUD_API", "META_COEXISTENCE"] as const;

/** Longitud mínima del secreto compartido: por debajo, la superficie queda cerrada. */
export const MIN_SECRET_LENGTH = 16;

/**
 * `Authorization: Bearer <secreto>` en tiempo constante. Sin `PROVISION_API_KEY`
 * configurada —o demasiado corta— nadie entra, ni siquiera con la cabecera justa.
 */
export function isAuthorized(header: string | null, expected: string | undefined): boolean {
  if (!expected || expected.length < MIN_SECRET_LENGTH || !header) return false;
  const prefix = "Bearer ";
  if (!header.startsWith(prefix)) return false;
  const a = Buffer.from(header.slice(prefix.length));
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function parseProvisionPayload(body: unknown): ParseResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, message: "El cuerpo debe ser un objeto JSON." };
  }
  const raw = body as Record<string, unknown>;

  const wabaId = str(raw.waba_id);
  if (!wabaId) return { ok: false, message: "Falta waba_id." };

  const phoneNumberId = str(raw.phone_number_id);
  if (!phoneNumberId) return { ok: false, message: "Falta phone_number_id." };

  const token = str(raw.token);
  if (!token) return { ok: false, message: "Falta el token de acceso del número." };

  // allok manda su propio `status` ("subscribed", …). No se copia: si estamos
  // provisionando, la credencial es nueva y vale `connected`. Mapearlo dejaría
  // entrar vocabulario de allok en el enum de vocero.
  const mode = str(raw.connection_mode) ?? "META_CLOUD_API";
  if (!MODES.includes(mode as (typeof MODES)[number])) {
    return { ok: false, message: `connection_mode inválido: ${mode}.` };
  }

  return {
    ok: true,
    payload: {
      organizationId: str(raw.organization_id),
      wabaId,
      phoneNumberId,
      token,
      displayPhoneNumber: str(raw.display_phone_number),
      verifiedName: str(raw.verified_name),
      connectionMode: mode as (typeof MODES)[number],
    },
  };
}

/**
 * Vocero es mono-organización por instancia (una instancia = un negocio). Si
 * allok manda un `organization_id`, tiene que ser el de ESTA instancia: recibir
 * el de otro cliente significa que alguien apuntó el destino equivocado, y
 * atarlo en silencio entregaría los mensajes de un negocio a otro.
 */
export function resolveTargetOrg(
  requested: string | null,
  instanceOrgId: string | null
): { ok: true; organizationId: string } | { ok: false; message: string } {
  if (!instanceOrgId) {
    return { ok: false, message: "Esta instancia todavía no tiene una organización; completá el registro primero." };
  }
  if (requested && requested !== instanceOrgId) {
    return { ok: false, message: "El organization_id no corresponde a esta instancia de Vocero." };
  }
  return { ok: true, organizationId: instanceOrgId };
}

import { MetaApiError } from "@/lib/meta/client";

/**
 * Fork — el motivo que se guarda cuando Meta rechaza un evento de la
 * Conversions API. El caso que más pasa al empezar es de permisos: el token
 * del negocio sale del Embedded Signup, y solo puede publicar en el dataset si
 * la configuración de inicio de sesión pide `whatsapp_business_manage_events`
 * (y la app lo tiene aprobado). Meta lo dice con un código, no con palabras
 * que el dueño entienda, así que se traduce aquí.
 */
export function motivoFalloCapi(err: unknown): string {
  const base = err instanceof Error ? err.message : String(err);
  if (err instanceof MetaApiError && (err.code === 10 || err.code === 200 || err.code === 3)) {
    return (
      "Falta el permiso whatsapp_business_manage_events: la app de Meta debe tenerlo " +
      "aprobado y la conexión de WhatsApp debe volver a hacerse con él. " +
      `(Meta: ${base})`
    );
  }
  return base;
}

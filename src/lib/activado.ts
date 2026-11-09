/**
 * «¿Este negocio ya encendió alguna vez a su agente?». Puro y sin servidor.
 *
 * La puesta en marcha (el asistente de alta) solo existe para quien NUNCA lo
 * activó. Un agente que se pausó después de haber atendido a clientes no vuelve
 * a ser «alta»: ni el interruptor se esconde, ni el lateral dice «Puesta en
 * marcha». No hay columna para esto y no se agrega una (sería una migración),
 * así que se lee de dos sitios:
 *
 * 1. `organization.metadata.allok.activatedAt`: lo escribe `PUT /api/agent/
 *    profile` en la primera activación que pasa (`server/agencia/activado.ts`).
 * 2. Negocios anteriores a esa marca: si el agente ya mandó, a un cliente de
 *    verdad, algún mensaje (saliente generado por IA en una conversación que no
 *    es de prueba), estuvo activo. Es barato (un `exists` con límite 1) y no
 *    da falsos positivos: la prueba y «Escríbele como cliente» viven en
 *    conversaciones `is_test`. Y `agent_profile.enabled = true` cuenta sin leer
 *    nada más (lo trae la preparación).
 */
export function activatedAtFromMetadata(metadata: string | null | undefined): string | null {
  if (!metadata) return null;
  try {
    const parsed = JSON.parse(metadata) as { allok?: { activatedAt?: unknown } } | null;
    const at = parsed?.allok?.activatedAt;
    return typeof at === "string" && at ? at : null;
  } catch {
    return null;
  }
}

/**
 * La inferencia por mensajes solo vale para negocios creados ANTES de que
 * existiera la marca `activatedAt`. Los nuevos nacen sin ella y la ponen en su
 * primera activación; y «Cargar datos de demostración» (`server/seed/demo.ts`)
 * mete salientes de IA en conversaciones reales (no `is_test`) que no prueban
 * nada: un negocio nuevo con la demo cargada seguiría en alta.
 */
export const ACTIVATED_MARK_CUTOFF = new Date("2026-11-10T00:00:00Z");

/** El `wa_message_id` de los mensajes de la demo (`seed/demo.ts`): nunca cuentan. */
export const DEMO_WAMID_LIKE = "wamid.demo.%";

export function everActivatedFrom(input: {
  enabled: boolean;
  metadata: string | null | undefined;
  hasRealAiOutbound: boolean;
}): boolean {
  return input.enabled || activatedAtFromMetadata(input.metadata) !== null || input.hasRealAiOutbound;
}

/**
 * La decisión completa, con sus lecturas y su escritura inyectadas (para
 * probarla sin base): 1) la marca manda; 2) encendido hoy sin marca = se
 * auto-repara escribiéndola, para que pausar después no reabra la alta; 3) solo
 * un negocio anterior al corte puede inferirlo de sus mensajes de IA reales.
 * Escribir la marca nunca rompe la lectura de quien llama.
 */
export async function resolveEverActivated(input: {
  enabled: boolean;
  metadata: string | null | undefined;
  createdAt: Date | null | undefined;
  hasRealAiOutbound: () => Promise<boolean>;
  mark: () => Promise<void>;
  onMarkError?: (error: unknown) => void;
}): Promise<boolean> {
  if (activatedAtFromMetadata(input.metadata)) return true;
  if (input.enabled) {
    await input.mark().catch((error) => input.onMarkError?.(error));
    return true;
  }
  if (input.createdAt && input.createdAt < ACTIVATED_MARK_CUTOFF) return input.hasRealAiOutbound();
  return false;
}

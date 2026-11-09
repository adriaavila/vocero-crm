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

export function everActivatedFrom(input: {
  enabled: boolean;
  metadata: string | null | undefined;
  hasRealAiOutbound: boolean;
}): boolean {
  return input.enabled || activatedAtFromMetadata(input.metadata) !== null || input.hasRealAiOutbound;
}

import { isNeaBrain } from "@/lib/env";

/**
 * Capa de agencia: ¿Nea (el cerebro externo) contesta en este negocio?
 *
 * Hasta esta migración, `BOT_API_KEY` sola bastaba, y en SaaS eso solo cubría
 * el negocio heredado (`principal`): Nea escuchaba su PROPIA suscripción al
 * webhook de Meta, así que era el único número que oía. Cualquier otro
 * negocio del SaaS se quedaba sin nadie que le contestara — el bug que esta
 * migración corrige.
 *
 * Ahora el CRM DESPACHA cada turno a Nea (`server/ai/nea-dispatch.ts`), así
 * que ya no existe "el negocio que Nea escucha": cualquier organización con
 * Nea configurada (`isNeaBrain()`) recibe el despacho. El parámetro se
 * conserva por compatibilidad con quien llama; ya no decide nada.
 */
export async function cerebroExternoAtiende(_organizationId: string): Promise<boolean> {
  return isNeaBrain();
}

import { isExternalBrainConfigured, isNeaBrain } from "@/lib/env";
import { isAllokSaaSMode } from "@/lib/tenant-host";
import { resolveLegacyOrganizationId } from "@/server/auth/on-signup";

/**
 * Capa de agencia: ¿el cerebro externo (`BOT_API_KEY`) contesta en este
 * negocio?
 *
 * En una instancia dedicada la clave es del único negocio: sí, y el agente
 * interno se hace a un lado. En SaaS la clave también es una sola, pero
 * SIN despacho (`isNeaBrain()` en falso) el bot que la usa atiende solo la
 * organización heredada, `principal` — porque escucha su PROPIA suscripción
 * al webhook de Meta para ese número, y nada más. Si la clave callara al
 * agente interno en todos los negocios, cada negocio nuevo se quedaría sin
 * nadie que le conteste.
 *
 * Con despacho (`isNeaBrain()` en true) el CRM ya no depende de a quién
 * escucha Nea por su cuenta — el CRM manda cada turno explícitamente por
 * conversación — así que esta restricción de "solo `principal`" no aplica: el
 * llamador (`trigger.ts`) resuelve el caso Nea ANTES de preguntar aquí.
 */
export async function cerebroExternoAtiende(organizationId: string): Promise<boolean> {
  if (!isExternalBrainConfigured()) return false;
  if (!isAllokSaaSMode()) return true;
  return organizationId === (await resolveLegacyOrganizationId());
}

/**
 * ¿Un cerebro externo LEGADO (`BOT_API_KEY` sin despacho) obliga a que una
 * conversación cuente como "encendida" sin que el dueño programe nada?
 *
 * Nea (`isNeaBrain()`) NO cae aquí a propósito: respeta `profile.enabled`
 * exactamente igual que Rei (el despacho en `pipeline.ts` ya hace ese gate),
 * así que un negocio con el agente apagado se queda apagado también para
 * Nea. Sin este freno, `estado.ts`/`ia-inicial.ts` mostraban "allok contesta
 * por ti" con Nea configurada aunque nadie hubiera encendido nada — un
 * cerebro externo LEGADO sí necesita este freno porque el CRM no controla
 * si contesta o no (escucha su propio webhook), pero Nea sí, y sí lo hace.
 */
export async function cerebroExternoLegadoSiempreOn(organizationId: string): Promise<boolean> {
  if (isNeaBrain()) return false;
  return cerebroExternoAtiende(organizationId);
}

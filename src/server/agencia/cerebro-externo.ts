import { isExternalBrainConfigured } from "@/lib/env";
import { isAllokSaaSMode } from "@/lib/tenant-host";
import { resolveLegacyOrganizationId } from "@/server/auth/on-signup";

/**
 * Capa de agencia: ¿el cerebro externo (`BOT_API_KEY`) contesta en este
 * negocio?
 *
 * En una instancia dedicada la clave es del único negocio: sí, y el agente
 * interno se hace a un lado. En SaaS la clave también es una sola, pero el bot
 * que la usa (Nea) atiende solo la organización heredada, `principal`. Si la
 * clave callara al agente interno en todos los negocios, cada negocio nuevo se
 * quedaría sin nadie que le conteste.
 */
export async function cerebroExternoAtiende(organizationId: string): Promise<boolean> {
  if (!isExternalBrainConfigured()) return false;
  if (!isAllokSaaSMode()) return true;
  return organizationId === (await resolveLegacyOrganizationId());
}

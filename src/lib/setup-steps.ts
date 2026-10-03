/**
 * Los cuatro pasos de la puesta en marcha, con su nombre y su pantalla. Puro y
 * sin servidor: lo importan la UI (el registro anuncia los pasos que siguen) y
 * el cálculo (`server/agencia/setup-progress.ts`), así que el nombre de un paso
 * se escribe una sola vez. Crear la cuenta pasa antes y no es un paso.
 */

export const SETUP_STEP_ORDER = ["whatsapp", "negocio", "probar", "activar"] as const;
export type SetupStepKey = (typeof SETUP_STEP_ORDER)[number];

export const SETUP_STEP_META: Record<SetupStepKey, { label: string; href: string }> = {
  whatsapp: { label: "Conectar WhatsApp", href: "/settings/whatsapp" },
  negocio: { label: "Tu negocio", href: "/agent" },
  probar: { label: "Probar", href: "/lab" },
  activar: { label: "Activar", href: "/agent#activar" },
};

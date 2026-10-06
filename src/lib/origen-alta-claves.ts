/**
 * Capa de agencia (fork) — las claves del origen de un alta, sin nada más:
 * el formulario de registro las importa en el navegador sin arrastrar Zod
 * (la limpieza vive en `lib/origen-alta`).
 */

/** Lo único que se guarda. Cualquier otra clave se tira sin mirarla. */
export const ORIGEN_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "ref",
  "fbclid",
  "gclid",
  "landing",
  "referrer",
] as const;

export type OrigenKey = (typeof ORIGEN_KEYS)[number];
export type OrigenAlta = Partial<Record<OrigenKey, string>>;
/** Lo guardado en `metadata.allok.origen`: el origen más cuándo se anotó. */
export type OrigenGuardado = OrigenAlta & { at: string };

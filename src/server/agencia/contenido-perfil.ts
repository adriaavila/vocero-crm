/**
 * Capa de agencia: qué cambios del perfil del agente cambian lo que DICE.
 *
 * La simulación («Probar») evalúa cómo contesta el agente, y eso depende del
 * texto del perfil y de la información del negocio, no de si está encendido.
 * Antes cualquier guardado del perfil, incluso solo pausar, movía `updatedAt`
 * y la prueba quedaba vieja: activar obligaba a probar otra vez sin que nada
 * hubiera cambiado. Ahora `updatedAt` es la versión del CONTENIDO y solo se
 * mueve cuando alguno de estos campos cambia de verdad.
 */

export const PROFILE_CONTENT_FIELDS = [
  "name",
  "tone",
  "instructions",
  "escalationRules",
  "greeting",
] as const;

export type ProfileContentField = (typeof PROFILE_CONTENT_FIELDS)[number];
export type ProfileContent = Partial<Record<ProfileContentField, string | null | undefined>>;

const norm = (value: string | null | undefined) => (value ?? "").trim();

/** ¿El parche cambia algún campo de contenido respecto de lo guardado? */
export function profileContentChanged(stored: ProfileContent, patch: ProfileContent): boolean {
  return PROFILE_CONTENT_FIELDS.some(
    (field) => patch[field] !== undefined && norm(patch[field]) !== norm(stored[field]),
  );
}

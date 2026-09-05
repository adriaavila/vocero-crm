/**
 * Qué versión está corriendo.
 *
 * Existe para responder una pregunta que hoy no tiene respuesta desde la app:
 * "¿ya se desplegó mi cambio?". Sin esto hay que ir al servidor a comparar
 * commits, y en la práctica nadie lo hace — se asume que sí, y se depura
 * durante media hora un bug que ya estaba arreglado en un build que nunca
 * llegó.
 *
 * Los dos valores se congelan al CONSTRUIR (ver `next.config.ts`): el binario
 * lleva dentro de qué código salió, así que no pueden mentir en tiempo de
 * ejecución.
 */

/** SemVer de `package.json`. Cambia cuando alguien publica, no en cada push. */
export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0";

/**
 * Commit del que salió el build, corto. Vacío si quien construyó no lo pasó
 * (`--build-arg SOURCE_COMMIT=...`); Coolify lo inyecta solo.
 *
 * Es el que de verdad zanja la duda: dos despliegues seguidos de `main` sin
 * tocar la versión se ven idénticos por SemVer y distintos por commit.
 */
export const BUILD_COMMIT = (process.env.NEXT_PUBLIC_BUILD_COMMIT ?? "").slice(0, 7);

/**
 * Commit resuelto EN EL SERVIDOR.
 *
 * Primero el que se congeló al construir; si quien construyó no lo pasó, el que
 * la plataforma anuncia en tiempo de ejecución. Coolify, por ejemplo, publica
 * `SOURCE_COMMIT` en el contenedor pero no siempre lo inyecta como build-arg:
 * sin este respaldo, la insignia enseñaría solo la versión — que no se mueve
 * entre despliegues del mismo release y por tanto no responde la pregunta.
 *
 * Solo tiene sentido llamarla desde el servidor: en el cliente, `process.env`
 * únicamente lleva las variables `NEXT_PUBLIC_`.
 */
export function resolveBuildCommit(): string {
  return BUILD_COMMIT || (process.env.SOURCE_COMMIT ?? "").slice(0, 7);
}

/**
 * `v1.1.0 · 8e62d0b`, o solo `v1.1.0` si no hay commit por ningún lado.
 * El `commit` se pasa cuando lo resolvió el servidor.
 */
export function versionLabel(commit: string = BUILD_COMMIT): string {
  return commit ? `v${APP_VERSION} · ${commit}` : `v${APP_VERSION}`;
}

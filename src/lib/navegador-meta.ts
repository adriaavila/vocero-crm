/**
 * Capa de agencia — dónde se puede abrir la ventana de Meta (Embedded Signup).
 *
 * La conexión de WhatsApp necesita dos cosas del navegador: cargar el SDK de
 * `connect.facebook.net` y abrir la ventana emergente de Meta, que avisa de
 * vuelta por `postMessage`. Dos navegadores comunes rompen eso sin decir nada:
 *
 * - Los navegadores DENTRO de Instagram, Facebook o TikTok (quien llega de un
 *   anuncio o de la bio cae ahí): la ventana se abre en otra vista y nunca
 *   avisa de vuelta.
 * - Un bloqueador de anuncios (Brave, uBlock, Safari con bloqueadores): el SDK
 *   de Meta no carga y el botón se quedaba en «Cargando Meta…» para siempre.
 *
 * Aquí viven las piezas puras; el puente (`embedded-signup-bridge.tsx`) las usa.
 */

/** Cuánto esperar al SDK de Meta antes de decirle al dueño que no cargó. */
export const META_SDK_TIMEOUT_MS = 12_000;

const IN_APP_BROWSERS: Array<[RegExp, string]> = [
  [/Instagram/i, "Instagram"],
  [/FBAN|FBAV|FB_IAB|FBIOS|FB4A|\bMessenger/i, "Facebook"],
  [/musical_ly|BytedanceWebview|TikTok/i, "TikTok"],
  [/\bLine\//i, "LINE"],
];

/** Nombre de la app cuyo navegador interno es este, o null en un navegador normal. */
export function inAppBrowserName(userAgent: string | null | undefined): string | null {
  if (!userAgent) return null;
  for (const [pattern, name] of IN_APP_BROWSERS) {
    if (pattern.test(userAgent)) return name;
  }
  return null;
}

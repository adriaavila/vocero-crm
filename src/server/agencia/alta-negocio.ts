import { isReservedSubdomain, isTenantSlug } from "@/lib/tenant-host";

/**
 * Alta hecha por un admin (`POST /api/saas/businesses`): la dirección del
 * negocio la elige el admin, no sale sola del nombre.
 *
 * Antes el subdominio se derivaba del nombre y, si chocaba, ganaba un sufijo
 * con el id del usuario: "Condominio Santorini" quedaba en
 * `condominio-santorini` aunque el admin quisiera `santorini`, y un choque
 * dejaba `santorini-a1b2c3`. El admin se enteraba al final, con la cuenta ya
 * creada. Aquí la dirección se valida ANTES de crear nada.
 */

export type DireccionInvalida = { ok: false; message: string };

/** Normaliza lo que escribe el admin: minúsculas, sin espacios alrededor. */
export function normalizarDireccion(value: string): string {
  return value.trim().toLowerCase();
}

/** Pura: forma y reservas. Que esté libre lo decide la base. */
export function validarDireccion(slug: string): { ok: true } | DireccionInvalida {
  if (!isTenantSlug(slug)) {
    return {
      ok: false,
      message: "La dirección solo puede tener letras sin acento, números y guiones, sin guion al principio ni al final.",
    };
  }
  if (isReservedSubdomain(slug)) {
    return { ok: false, message: "Esa dirección está reservada. Prueba con otra." };
  }
  return { ok: true };
}

/** El mensaje que el admin le pasa al dueño. La contraseña nunca va aquí. */
export function mensajeParaElDueno(params: { nombre: string; url: string; email: string }): string {
  const host = params.url.replace(/^https?:\/\//, "");
  return [
    `Hola, ya está listo ${params.nombre}.`,
    `Entra en ${host}/login con ${params.email}. La contraseña te la paso aparte; cámbiala en Cuenta apenas entres.`,
    "Lo primero es «Tu negocio»: ahí le cuentas al agente qué vendes y cómo atiendes.",
  ].join("\n\n");
}

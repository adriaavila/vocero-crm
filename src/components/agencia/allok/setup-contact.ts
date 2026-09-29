import { brand } from "@/lib/brand";

/**
 * El contacto de la marca del despliegue, adonde va quien quiere empezar o
 * perdió el acceso de propietario. El texto de allok es el mismo del sitio
 * público a propósito: su agente sólo arranca cuando el mensaje coincide
 * exacto con una frase de activación.
 *
 * Server-only: lee `brand()` (que a su vez lee `process.env.BRAND`), así que
 * un componente cliente NUNCA debe importar esto directo — lo resuelve un
 * componente de servidor y baja el resultado por prop (`process.env.BRAND` no
 * es `NEXT_PUBLIC_`, así que en el bundle del navegador siempre sería
 * `undefined`, sin importar la marca real del despliegue).
 */

/** Solo dígitos: un wa.me con un "+" o un espacio de más no abre nada. */
function digits(value: string): string {
  return value.replace(/\D/g, "");
}

function contactHref(message: string): string {
  const { contact } = brand();
  if (contact.whatsapp) {
    return `https://wa.me/${digits(contact.whatsapp)}?text=${encodeURIComponent(message)}`;
  }
  if (contact.email) {
    return `mailto:${contact.email}?subject=${encodeURIComponent(message)}`;
  }
  return "#";
}

export function startUrl(): string {
  return contactHref(brand().startMessage);
}

export function helpUrl(): string {
  return contactHref(brand().helpMessage);
}

/** "por WhatsApp" / "por correo", para que el botón diga por dónde escribe de verdad. */
export function contactChannelSuffix(): string {
  const { contact } = brand();
  if (contact.whatsapp) return "por WhatsApp";
  if (contact.email) return "por correo";
  return "";
}

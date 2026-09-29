import { brand } from "@/lib/brand";

/**
 * El WhatsApp de la marca del despliegue, adonde va quien quiere empezar o
 * perdió el acceso de propietario. El texto es el mismo del sitio público a
 * propósito: el agente de allok sólo arranca cuando el mensaje coincide exacto
 * con una frase de activación.
 *
 * Server-only: lee `brand()` (que a su vez lee `process.env.BRAND`), así que
 * un componente cliente NUNCA debe importar esto directo — lo resuelve un
 * componente de servidor y baja el resultado por prop (`process.env.BRAND` no
 * es `NEXT_PUBLIC_`, así que en el bundle del navegador siempre sería
 * `undefined`, sin importar la marca real del despliegue).
 */
export function startUrl(): string {
  const { contact, startMessage } = brand();
  if (!contact.whatsapp) return "#";
  return `https://wa.me/${contact.whatsapp}?text=${encodeURIComponent(startMessage)}`;
}

export function helpUrl(): string {
  const { contact, helpMessage } = brand();
  if (!contact.whatsapp) return "#";
  return `https://wa.me/${contact.whatsapp}?text=${encodeURIComponent(helpMessage)}`;
}

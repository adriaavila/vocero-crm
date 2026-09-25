/**
 * El WhatsApp de allok, adonde va quien quiere empezar o perdió el acceso de
 * propietario. El texto es el mismo de allok.fun a propósito: el agente de
 * allok sólo arranca cuando el mensaje coincide exacto con una frase de
 * activación.
 */
const ALLOK_WHATSAPP = "584220023684";

export const ALLOK_START_URL = `https://wa.me/${ALLOK_WHATSAPP}?text=${encodeURIComponent(
  "Hola, vengo de allok.fun. Quiero un agente de WhatsApp para mi negocio."
)}`;

export const ALLOK_HELP_URL = `https://wa.me/${ALLOK_WHATSAPP}?text=${encodeURIComponent(
  "Hola, necesito recuperar el acceso a mi cuenta de allok."
)}`;

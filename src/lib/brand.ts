/**
 * Identidad del DESPLIEGUE (no confundir con la marca white-label por
 * organización de `lib/branding.ts`, que sigue funcionando encima de esto).
 *
 * La misma imagen se despliega dos veces con identidad distinta según `BRAND`:
 *   BRAND=allok (default, sin variable) → allok.fun, exactamente el
 *     comportamiento de siempre (nada cambia).
 *   BRAND=rei                            → Rei en reiprop.tech.
 *
 * `ALLOK_BRAND=off` sigue significando "sin marca, Vocero puro" (ver
 * `isAllokBrand()` en `tenant-host.ts`) y no se toca acá: ese interruptor es
 * independiente de CUÁL marca se activa cuando sí hay una.
 *
 * Puro y sin servidor, como `tenant-host.ts`: solo lee `process.env` en cada
 * llamada (nunca lo congela en un const de módulo) para que los tests puedan
 * cambiarlo con `vi.stubEnv` y para que un único proceso de build sirva a
 * cualquiera de las dos marcas según el entorno de cada despliegue.
 */

export type BrandId = "allok" | "rei";

export type Brand = {
  id: BrandId;
  /** Mención en minúscula, tal como la escribe el producto en una oración. */
  name: string;
  /** La misma mención con mayúscula inicial, para el arranque de una oración o un rótulo. */
  Name: string;
  /** Nombre completo del producto, para metadatos y superficie pública. */
  productName: string;
  /** Acento por defecto de una organización nueva bajo esta marca (hex). */
  defaultAccent: string;
  /** Prefijo estable de "el registro empieza en <host>". */
  signupHostHint: string;
  /** Cómo llegar a un humano de esta marca (no de un negocio cliente). */
  contact: { whatsapp: string | null; email: string | null };
  /** A dónde manda "ver precios" (URL externa para allok, ruta interna para rei). */
  pricingHref: string;
  /** Mensaje precargado del wa.me de "quiero empezar". */
  startMessage: string;
  /** Mensaje precargado del wa.me de "perdí el acceso". */
  helpMessage: string;
};

function nonEmpty(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** `BRAND` sin configurar, vacío o cualquier valor que no sea "rei" → allok: el default de hoy. */
export function activeBrandId(): BrandId {
  return process.env.BRAND?.trim().toLowerCase() === "rei" ? "rei" : "allok";
}

/**
 * La marca activa de este despliegue. Nótese que esto NO decide si la marca
 * se aplica — eso lo sigue decidiendo `isAllokBrand()` en `tenant-host.ts`
 * (`ALLOK_BRAND=off` deja la instancia sin marca, sea cual sea `BRAND`).
 */
export function brand(): Brand {
  return brandById(activeBrandId());
}

/**
 * Los valores de una marca por su id, sin pasar por `BRAND`. Función y no un
 * objeto congelado a propósito — el contacto de Rei lee `process.env` en
 * cada llamada, igual que el resto del módulo, así que un `vi.stubEnv` en un
 * test se ve de inmediato y no solo en el primer import.
 */
export function brandById(id: BrandId): Brand {
  if (id === "rei") {
    return {
      id: "rei",
      name: "Rei",
      Name: "Rei",
      productName: "Rei",
      // Esmeralda rei (ver design/rei.md y el --rei-brand-500 portado del fork).
      defaultAccent: "#0a7350",
      signupHostHint: "El registro de Rei empieza en",
      // El WhatsApp/correo de Rei sí sale del entorno: cada despliegue de Rei
      // (SaaS o dedicado) tiene el suyo, y no hay uno de fábrica que inventar.
      contact: {
        whatsapp: nonEmpty(process.env.CONTACT_WHATSAPP),
        email: nonEmpty(process.env.CONTACT_EMAIL),
      },
      pricingHref: "/precios",
      startMessage: "Hola, vengo de Rei. Quiero un agente de WhatsApp para mi inmobiliaria.",
      helpMessage: "Hola, necesito recuperar el acceso a mi cuenta de Rei.",
    };
  }
  return {
    id: "allok",
    name: "allok",
    Name: "Allok",
    productName: "allok",
    // Tinta — el acento del SaaS allok (SAAS_BRANDING en lib/branding.ts).
    defaultAccent: "#0b0d0e",
    signupHostHint: "El registro de Allok empieza en",
    // El WhatsApp de allok es de allok: fijo, no sale del entorno.
    contact: { whatsapp: "584220023684", email: null },
    pricingHref: "https://allok.fun/#precios",
    startMessage: "Hola, vengo de allok.fun. Quiero un agente de WhatsApp para mi negocio.",
    helpMessage: "Hola, necesito recuperar el acceso a mi cuenta de allok.",
  };
}

/**
 * Qué le falta a Rei para hablarle a un cliente de verdad: sin
 * CONTACT_WHATSAPP/CONTACT_EMAIL el sitio público no tiene a dónde mandar un
 * "quiero empezar" (cae a la demo); sin LEGAL_NAME/LEGAL_ADDRESS los legales
 * imprimen "[pendiente: ...]" en vez de un dato real. Vacío para allok (trae
 * los suyos de fábrica) y para cualquier instancia fuera del SaaS.
 */
export function missingReiConfigVars(saasMode: boolean): string[] {
  if (!saasMode || activeBrandId() !== "rei") return [];
  const missing: string[] = [];
  // Sin dominio propio Rei cae en silencio a allok.fun y ningún host matchea.
  const root = process.env.ALLOK_ROOT_DOMAIN?.trim();
  if (!root || root === ".") missing.push("ALLOK_ROOT_DOMAIN");
  if (!nonEmpty(process.env.CONTACT_WHATSAPP) && !nonEmpty(process.env.CONTACT_EMAIL)) {
    missing.push("CONTACT_WHATSAPP", "CONTACT_EMAIL");
  }
  if (!nonEmpty(process.env.LEGAL_NAME)) missing.push("LEGAL_NAME");
  if (!nonEmpty(process.env.LEGAL_ADDRESS)) missing.push("LEGAL_ADDRESS");
  return missing;
}

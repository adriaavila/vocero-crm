import {
  formatPrice,
  formatZone,
  isOperation,
  isPaymentMethod,
  isPropertyKind,
  OPERATION_LABELS,
  PAYMENT_METHOD_LABELS,
  PROPERTY_KIND_LABELS,
  derivedTitle,
} from "@/lib/realty/catalog";
import { isRealtyOrg } from "@/server/agencia/vertical";
import { listProperties } from "@/server/realty/properties";
import type { CatalogProperty } from "@/server/lab/personas";

/**
 * Fork — el agente conoce el catálogo de Propiedades.
 *
 * Una inmobiliaria cargaba sus casas en Propiedades y el agente no las veía:
 * su única fuente era el conocimiento (P/R). Al cliente que preguntaba «¿qué
 * casas tienen en Santorini?» le contestaba «lo confirmo con el equipo»,
 * aunque la casa, su precio y sus formas de pago estaban cargados.
 *
 * Va en un mensaje de sistema APARTE (como la memoria del cliente), así la
 * versión del prompt del agente no cambia cada vez que se edita una propiedad.
 * Solo las disponibles: una apartada o cerrada no se ofrece. Sin vertical o
 * sin propiedades, nada: allok no cambia.
 */

export const CATALOGO_MAX = 40;
/** La descripción entra recortada: la entrega y la oferta suelen ir al final. */
export const DESCRIPCION_MAX = 450;

export const CATALOGO_ENCABEZADO =
  "CATÁLOGO DE PROPIEDADES DISPONIBLES (también es tu fuente de verdad: usa los precios, zonas y formas de pago EXACTOS de aquí; no ofrezcas propiedades que no estén en esta lista ni inventes datos que no aparezcan aquí o en el conocimiento):";

/** Una línea por propiedad. PURA. */
export function renderCatalogo(properties: CatalogProperty[]): string {
  return properties
    .slice(0, CATALOGO_MAX)
    .map((p) => {
      const title = p.title?.trim() || derivedTitle(p.kind, p.city);
      const kind = isPropertyKind(p.kind) ? PROPERTY_KIND_LABELS[p.kind] : "Inmueble";
      const operation = isOperation(p.operation)
        ? OPERATION_LABELS[p.operation].toLowerCase()
        : p.operation;
      const payments = p.acceptedPayments.filter(isPaymentMethod).map((m) => PAYMENT_METHOD_LABELS[m]);
      return [
        `- «${title}»`,
        `${kind} en ${operation}`,
        formatZone(p.neighborhood, p.city),
        formatPrice(p.price, p.currency),
        p.bedrooms != null ? `${p.bedrooms} dorm` : null,
        payments.length ? `pago: ${payments.join(", ")}` : null,
      ]
        .filter(Boolean)
        .join(" · ")
        .concat(descripcion(p.description));
    })
    .join("\n");
}

// SAMER (Rei, 22-10): sin la ficha, el agente dijo que Santorini estaba
// «terminado y con entrega inmediata»; la entrega de cada casa estaba en su
// descripción.
function descripcion(texto: string | null | undefined): string {
  const limpio = texto?.replace(/\s+/g, " ").trim();
  if (!limpio) return "";
  return limpio.length > DESCRIPCION_MAX
    ? ` — ${limpio.slice(0, DESCRIPCION_MAX - 1)}…`
    : ` — ${limpio}`;
}

/** El bloque para el prompt del agente (y el juez), o `null` si no aplica. */
export async function catalogoParaPrompt(organizationId: string): Promise<string | null> {
  try {
    if (!(await isRealtyOrg(organizationId))) return null;
    const { properties } = await listProperties(organizationId, {
      status: "disponible",
      pageSize: CATALOGO_MAX,
    });
    if (properties.length === 0) return null;
    return `${CATALOGO_ENCABEZADO}\n${renderCatalogo(properties)}`;
  } catch (err) {
    // Sin catálogo el agente contesta igual, solo con el conocimiento.
    console.error("[agente] no se pudo leer el catálogo:", err);
    return null;
  }
}

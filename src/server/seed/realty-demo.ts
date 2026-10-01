import { eq } from "drizzle-orm";
import type { getDb } from "@/lib/db";
import { schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { bumpCatalogVersion } from "@/server/realty/properties";
import type {
  Amenity,
  Currency,
  Operation,
  PaymentMethod,
} from "@/lib/realty/catalog";

/**
 * Inventario y agente demo del vertical inmobiliario: "Inmobiliaria
 * Cordillera", 8 anuncios bolivianos. Se usa en vez de la demo de ferretería
 * (`server/seed/demo.ts`) cuando la organización tiene el vertical activo —
 * ver `src/app/api/seed/demo/route.ts`.
 *
 * Portado del fork inmobiliario (`vocero-inmobiliario-main`,
 * `server/seed/{demo,realty}.ts`): a propósito solo el catálogo y el perfil
 * del agente, sin sus contactos/KB/corridas de ejemplo — esos hablan de
 * requerimientos y matching (parte 2, todavía no existe en este repo) y
 * poblarlos ahora dejaría una demo a medias en vez de una vacía y honesta.
 *
 * Idempotente (Constitución IV): re-ejecutable, borra el inventario demo
 * previo de la organización (por el prefijo del título) antes de reinsertar.
 * Sin fotos a propósito: pesarían en el repo y la ficha (parte 2) degrada a
 * texto sin fallar, que es justo el camino que conviene ver primero.
 */

type Db = ReturnType<typeof getDb>;

const DEMO_TITLE_PREFIX = "[Demo]";

const DEMO_PROPERTIES: {
  title: string;
  operation: Operation;
  kind: "casa" | "departamento" | "local" | "terreno" | "oficina" | "bodega";
  price: string;
  currency: Currency;
  neighborhood: string;
  city: string;
  bedrooms?: number;
  bathrooms?: string;
  builtArea?: string;
  parking?: number;
  amenities: Amenity[];
  acceptedPayments: PaymentMethod[];
  status?: "disponible" | "apartada" | "cerrada";
  description?: string;
}[] = [
  {
    title: `${DEMO_TITLE_PREFIX} Depto en Equipetrol`,
    operation: "venta",
    kind: "departamento",
    price: "135000",
    currency: "USD",
    neighborhood: "Equipetrol",
    city: "Santa Cruz",
    bedrooms: 2,
    bathrooms: "2",
    builtArea: "92",
    parking: 1,
    amenities: ["seguridad", "elevador", "gimnasio", "cocina_integral"],
    acceptedPayments: ["contado", "credito_bancario"],
    description: "Edificio con portería 24 h, a dos cuadras del Cristo Redentor.",
  },
  {
    title: `${DEMO_TITLE_PREFIX} Casa en el Urubó`,
    operation: "venta",
    kind: "casa",
    price: "285000",
    currency: "USD",
    neighborhood: "Urubó",
    city: "Porongo",
    bedrooms: 4,
    bathrooms: "3.5",
    builtArea: "320",
    parking: 2,
    amenities: ["jardin", "alberca", "seguridad", "estacionamiento", "cisterna"],
    acceptedPayments: ["contado", "credito_bancario"],
    description: "Casa en condominio cerrado, pasando el puente. Piscina y quincho.",
  },
  {
    title: `${DEMO_TITLE_PREFIX} Depto amoblado en Calacoto`,
    operation: "renta",
    kind: "departamento",
    price: "850",
    currency: "USD",
    neighborhood: "Calacoto",
    city: "La Paz",
    bedrooms: 2,
    bathrooms: "2",
    builtArea: "88",
    parking: 1,
    amenities: ["amueblado", "seguridad", "elevador", "aire_acondicionado"],
    acceptedPayments: ["contado"],
    description: "Amoblado y listo para entrar. Precio mensual, garantía de dos meses.",
  },
  {
    title: `${DEMO_TITLE_PREFIX} Depto en Sopocachi`,
    operation: "renta",
    kind: "departamento",
    price: "3150",
    currency: "BOB",
    neighborhood: "Sopocachi",
    city: "La Paz",
    bedrooms: 2,
    bathrooms: "1",
    builtArea: "70",
    amenities: ["acepta_mascotas", "cocina_integral"],
    acceptedPayments: ["contado"],
    // Único en bolivianos a propósito: el matching (parte 2) no cruza
    // monedas distintas, y conviene que el operador vea ese caso primero.
    description: "Alquiler en bolivianos. Zona con mucho comercio y micros.",
  },
  {
    title: `${DEMO_TITLE_PREFIX} Depto en anticrético, San Miguel`,
    operation: "anticretico",
    kind: "departamento",
    price: "28000",
    currency: "USD",
    neighborhood: "San Miguel",
    city: "La Paz",
    bedrooms: 3,
    bathrooms: "2",
    builtArea: "105",
    parking: 1,
    amenities: ["seguridad", "elevador"],
    acceptedPayments: ["contado"],
    description: "Anticrético a dos años, monto devuelto íntegro al vencimiento.",
  },
  {
    title: `${DEMO_TITLE_PREFIX} Casa en Cala Cala`,
    operation: "venta",
    kind: "casa",
    price: "78000",
    currency: "USD",
    neighborhood: "Cala Cala",
    city: "Cochabamba",
    bedrooms: 3,
    bathrooms: "2",
    builtArea: "115",
    parking: 1,
    amenities: ["jardin", "estacionamiento"],
    // El caso que decide la viabilidad de un prospecto en Bolivia.
    acceptedPayments: ["credito_vis", "credito_bancario"],
    description: "Entra en crédito de vivienda de interés social. Barrio tranquilo.",
  },
  {
    title: `${DEMO_TITLE_PREFIX} Penthouse en Equipetrol Norte`,
    operation: "venta",
    kind: "departamento",
    price: "395000",
    currency: "USD",
    neighborhood: "Equipetrol Norte",
    city: "Santa Cruz",
    bedrooms: 3,
    bathrooms: "3.5",
    builtArea: "260",
    parking: 3,
    amenities: ["roof_garden", "alberca", "gimnasio", "seguridad", "elevador", "terraza"],
    acceptedPayments: ["contado", "credito_bancario"],
    // Reservada a propósito: deja ver que NO aparece en el matching (parte 2).
    status: "apartada",
    description: "Último piso con terraza y vista al cuarto anillo.",
  },
  {
    title: `${DEMO_TITLE_PREFIX} Local sobre el segundo anillo`,
    operation: "renta",
    kind: "local",
    price: "1200",
    currency: "USD",
    neighborhood: "Segundo Anillo",
    city: "Santa Cruz",
    builtArea: "140",
    amenities: ["aire_acondicionado"],
    acceptedPayments: ["contado"],
    description: "Planta baja sobre avenida, con vitrina y baño. Precio mensual.",
  },
];

export async function seedRealtyDemo(
  db: Db,
  organizationId: string
): Promise<{ properties: number }> {
  // Idempotencia: se borra el inventario demo previo de ESTA organización.
  const previous = await db
    .select({ id: schema.property.id, title: schema.property.title })
    .from(schema.property)
    .where(eq(schema.property.organizationId, organizationId));
  const demoIds = previous
    .filter((p) => p.title?.startsWith(DEMO_TITLE_PREFIX))
    .map((p) => p.id);

  for (const id of demoIds) {
    // `property_match` cae en cascada; `property_photo` también, pero la
    // demo no siembra fotos. `booking_property` es `restrict`: no debería
    // haber ninguna referenciando una propiedad demo recién creada.
    await db.delete(schema.propertyMatch).where(eq(schema.propertyMatch.propertyId, id));
    await db.delete(schema.propertyPhoto).where(eq(schema.propertyPhoto.propertyId, id));
    await db.delete(schema.property).where(eq(schema.property.id, id));
  }

  for (const demo of DEMO_PROPERTIES) {
    await db.insert(schema.property).values({
      id: newId("property"),
      organizationId,
      operation: demo.operation,
      kind: demo.kind,
      title: demo.title,
      price: demo.price,
      currency: demo.currency,
      neighborhood: demo.neighborhood,
      city: demo.city,
      bedrooms: demo.bedrooms ?? null,
      bathrooms: demo.bathrooms ?? null,
      builtArea: demo.builtArea ?? null,
      parking: demo.parking ?? null,
      amenities: demo.amenities,
      acceptedPayments: demo.acceptedPayments,
      status: demo.status ?? "disponible",
      description: demo.description ?? null,
    });
  }

  // El inventario cambió: sube la versión para invalidar la caché de matches.
  await bumpCatalogVersion(organizationId);

  // Comportamiento del agente de la demo — mismo tono que el fork original.
  await db
    .update(schema.agentProfile)
    .set({
      name: "Rei",
      tone: "Cálida y profesional, de asesoría inmobiliaria con oficio. Tutea al cliente y va al grano.",
      instructions:
        "Averigua qué busca (operación, presupuesto, zona, dormitorios y forma de pago) y guárdalo. Ofrece SOLO propiedades del catálogo y agenda visitas SOLO en los horarios disponibles. Nunca inventes precios, direcciones ni amenidades.",
      escalationRules:
        "Escala a un humano si negocian el precio, si piden condiciones de crédito o legales, si hay una queja, o si lo piden explícitamente. No prometas reservas ni firmes nada.",
      greeting: "¡Hola! Soy Rei, de Inmobiliaria Cordillera 🏡 ¿Busca comprar, alquilar o anticrético?",
      updatedAt: new Date(),
    })
    .where(eq(schema.agentProfile.organizationId, organizationId));

  return { properties: DEMO_PROPERTIES.length };
}

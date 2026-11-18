import { and, asc, eq, isNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import {
  disponible,
  finDelDia,
  precio,
  type ExtraMenu,
  type ProductoMenu,
} from "@/lib/restaurante/pedido";
import { getSettings } from "@/server/agenda/settings";
import { getBranding } from "@/server/branding";
import { isRestauranteOrg } from "@/server/agencia/vertical";

/**
 * Fork — vertical restaurante: el menú del negocio. Es la ÚNICA fuente de
 * precios y de disponibilidad: lo lee la pantalla Menú, lo lee el agente y
 * de aquí sale cada línea de un pedido.
 */

export type MenuCategoryRow = typeof schema.menuCategory.$inferSelect;
export type MenuItemRow = typeof schema.menuItem.$inferSelect;

export type MenuCompleto = {
  currency: string;
  categories: { id: string; name: string; position: number }[];
  items: {
    id: string;
    categoryId: string | null;
    name: string;
    description: string | null;
    priceCents: number;
    available: boolean;
    soldOutUntil: string | null;
    /** Se puede ofrecer AHORA (encendido y no agotado por hoy). */
    enVenta: boolean;
    extras: ExtraMenu[];
  }[];
};

export async function leerMenu(organizationId: string, now = new Date()): Promise<MenuCompleto> {
  const db = getDb();
  const [categories, items, branding] = await Promise.all([
    db
      .select()
      .from(schema.menuCategory)
      .where(scoped(schema.menuCategory.organizationId, organizationId))
      .orderBy(asc(schema.menuCategory.position), asc(schema.menuCategory.createdAt)),
    db
      .select()
      .from(schema.menuItem)
      .where(scoped(schema.menuItem.organizationId, organizationId, isNull(schema.menuItem.archivedAt)))
      .orderBy(asc(schema.menuItem.position), asc(schema.menuItem.createdAt)),
    getBranding(organizationId),
  ]);
  return {
    currency: branding.currency,
    categories: categories.map((c) => ({ id: c.id, name: c.name, position: c.position })),
    items: items.map((i) => ({
      id: i.id,
      categoryId: i.categoryId,
      name: i.name,
      description: i.description,
      priceCents: i.priceCents,
      available: i.available,
      soldOutUntil: i.soldOutUntil ? i.soldOutUntil.toISOString() : null,
      enVenta: disponible(i, now),
      extras: i.extras,
    })),
  };
}

/** El menú como lo necesitan las reglas de pedido. */
export async function productosDelMenu(organizationId: string): Promise<ProductoMenu[]> {
  const rows = await getDb()
    .select()
    .from(schema.menuItem)
    .where(scoped(schema.menuItem.organizationId, organizationId, isNull(schema.menuItem.archivedAt)));
  return rows.map((i) => ({
    id: i.id,
    name: i.name,
    priceCents: i.priceCents,
    available: i.available,
    soldOutUntil: i.soldOutUntil,
    extras: i.extras,
  }));
}

export async function crearCategoria(organizationId: string, name: string): Promise<string> {
  const db = getDb();
  const existentes = await db
    .select({ id: schema.menuCategory.id, name: schema.menuCategory.name })
    .from(schema.menuCategory)
    .where(scoped(schema.menuCategory.organizationId, organizationId));
  const igual = existentes.find((c) => c.name.trim().toLowerCase() === name.trim().toLowerCase());
  if (igual) return igual.id;
  const id = newId("menuCategory");
  await db.insert(schema.menuCategory).values({
    id,
    organizationId,
    name: name.trim(),
    position: existentes.length,
  });
  return id;
}

export type ProductoInput = {
  name: string;
  description?: string | null;
  priceCents: number;
  categoryId?: string | null;
  extras?: { id?: string; name: string; priceCents: number; active?: boolean }[];
};

function limpiarExtras(extras: ProductoInput["extras"]): ExtraMenu[] {
  return (extras ?? [])
    .filter((e) => e.name.trim())
    .slice(0, 20)
    .map((e) => ({
      id: e.id || newId("menuExtra"),
      name: e.name.trim().slice(0, 60),
      priceCents: Math.max(0, Math.round(e.priceCents)),
      active: e.active ?? true,
    }));
}

async function categoriaDelNegocio(organizationId: string, categoryId: string | null | undefined) {
  if (!categoryId) return null;
  const rows = await getDb()
    .select({ id: schema.menuCategory.id })
    .from(schema.menuCategory)
    .where(scoped(schema.menuCategory.organizationId, organizationId, eq(schema.menuCategory.id, categoryId)))
    .limit(1);
  return rows[0]?.id ?? null;
}

export async function crearProducto(organizationId: string, input: ProductoInput): Promise<string> {
  const db = getDb();
  const cuantos = await db
    .select({ id: schema.menuItem.id })
    .from(schema.menuItem)
    .where(scoped(schema.menuItem.organizationId, organizationId));
  const id = newId("menuItem");
  await db.insert(schema.menuItem).values({
    id,
    organizationId,
    categoryId: await categoriaDelNegocio(organizationId, input.categoryId),
    name: input.name.trim(),
    description: input.description?.trim() || null,
    priceCents: Math.max(0, Math.round(input.priceCents)),
    extras: limpiarExtras(input.extras),
    position: cuantos.length,
  });
  return id;
}

export type ProductoCambio = Partial<ProductoInput> & {
  available?: boolean;
  /** true = agotado hasta que termine el día del negocio; false = vuelve ya. */
  agotadoHoy?: boolean;
  archived?: boolean;
};

/** Devuelve false si el producto no es de este negocio. */
export async function cambiarProducto(
  organizationId: string,
  id: string,
  cambio: ProductoCambio,
  now = new Date()
): Promise<boolean> {
  const set: Partial<typeof schema.menuItem.$inferInsert> = { updatedAt: now };
  if (cambio.name !== undefined) set.name = cambio.name.trim();
  if (cambio.description !== undefined) set.description = cambio.description?.trim() || null;
  if (cambio.priceCents !== undefined) set.priceCents = Math.max(0, Math.round(cambio.priceCents));
  if (cambio.categoryId !== undefined) {
    set.categoryId = await categoriaDelNegocio(organizationId, cambio.categoryId);
  }
  if (cambio.extras !== undefined) set.extras = limpiarExtras(cambio.extras);
  if (cambio.available !== undefined) set.available = cambio.available;
  if (cambio.agotadoHoy !== undefined) {
    const { timezone } = await getSettings(organizationId);
    set.soldOutUntil = cambio.agotadoHoy ? finDelDia(now, timezone) : null;
  }
  if (cambio.archived !== undefined) set.archivedAt = cambio.archived ? now : null;
  const rows = await getDb()
    .update(schema.menuItem)
    .set(set)
    .where(and(scoped(schema.menuItem.organizationId, organizationId), eq(schema.menuItem.id, id)))
    .returning({ id: schema.menuItem.id });
  return rows.length > 0;
}

/* ---------- Lo que lee el agente ---------- */

export const MENU_MAX = 80;

export const MENU_ENCABEZADO =
  "MENÚ DEL NEGOCIO (es tu ÚNICA fuente de productos, precios y extras: no ofrezcas nada que no esté en esta lista, no cambies un precio y no prometas un producto marcado AGOTADO HOY).\n" +
  "Cuando el cliente ya dijo qué quiere, arma el pedido con esta acción y nada más:\n" +
  '{"action":"prepare_order","items":[{"name":"<nombre EXACTO del menú>","quantity":1,"extras":["<extra de ese producto>"],"note":"<aclaración del cliente>"}],"mode":"envio" o "retiro","address":"<dirección si es envío>","reply":"<frase corta de entrada>"}\n' +
  "- Manda SIEMPRE el pedido completo (si el cliente agrega o quita algo, repite todo con el cambio).\n" +
  "- No escribas precios ni totales en reply: el sistema pone el detalle con los precios reales.\n" +
  "- No digas que el pedido está confirmado, ni el costo del envío, ni el tiempo de entrega: eso lo confirma una persona del local.\n" +
  "- Si falta saber si es para envío o para retiro, o falta la dirección de un envío, pregúntalo con reply antes o arma el pedido sin ese dato.\n" +
  "- Si piden algo que no está en el menú o está agotado, dilo y ofrece algo de la lista.";

/** Una línea por producto, agrupado por categoría. PURA. */
export function renderMenu(menu: MenuCompleto): string {
  const porCategoria = new Map<string | null, MenuCompleto["items"]>();
  for (const item of menu.items.slice(0, MENU_MAX)) {
    const lista = porCategoria.get(item.categoryId) ?? [];
    lista.push(item);
    porCategoria.set(item.categoryId, lista);
  }
  const bloques: string[] = [];
  const linea = (i: MenuCompleto["items"][number]) => {
    const extras = i.extras
      .filter((e) => e.active)
      .map((e) => (e.priceCents > 0 ? `${e.name} +${precio(e.priceCents, menu.currency)}` : e.name));
    return [
      `- ${i.name} · ${precio(i.priceCents, menu.currency)}`,
      i.enVenta ? null : "AGOTADO HOY",
      extras.length ? `extras: ${extras.join(", ")}` : null,
      i.description ? i.description.replace(/\s+/g, " ").slice(0, 140) : null,
    ]
      .filter(Boolean)
      .join(" · ");
  };
  for (const c of menu.categories) {
    const items = porCategoria.get(c.id);
    if (items?.length) bloques.push(`${c.name}:\n${items.map(linea).join("\n")}`);
  }
  const sueltos = [...porCategoria.entries()]
    .filter(([id]) => id === null || !menu.categories.some((c) => c.id === id))
    .flatMap(([, items]) => items);
  if (sueltos.length) bloques.push(sueltos.map(linea).join("\n"));
  return bloques.join("\n");
}

/** El bloque del menú para el agente, o null si el negocio no toma pedidos. */
export async function menuParaPrompt(organizationId: string): Promise<string | null> {
  if (!(await isRestauranteOrg(organizationId))) return null;
  const menu = await leerMenu(organizationId);
  if (menu.items.length === 0) return null;
  return `${MENU_ENCABEZADO}\n\n${renderMenu(menu)}`;
}

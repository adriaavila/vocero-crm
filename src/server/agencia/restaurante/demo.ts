import { crearCategoria, crearProducto, leerMenu } from "./menu";

/**
 * Fork — vertical restaurante: el menú de ejemplo «Doña Brasa».
 *
 * Es un restaurante que NO existe: sirve para que el dueño vea el producto
 * funcionando antes de cargar lo suyo. Solo se carga con el menú vacío y la
 * pantalla lo marca como ejemplo hasta que lo edite.
 */
const c = (bs: number) => bs * 100;

export const MENU_DEMO: {
  category: string;
  items: { name: string; price: number; description?: string; extras?: { name: string; priceCents: number }[] }[];
}[] = [
  {
    category: "Hamburguesas",
    items: [
      { name: "Clásica", price: c(32), description: "Carne a la brasa, lechuga, tomate y salsa de la casa." },
      {
        name: "Doble queso",
        price: c(42),
        description: "Doble carne y doble queso.",
        extras: [
          { name: "Sin cebolla", priceCents: 0 },
          { name: "Extra queso", priceCents: c(4) },
          { name: "Tocino", priceCents: c(6) },
        ],
      },
      { name: "La Brasa", price: c(48), description: "Carne, tocino, huevo y queso ahumado." },
    ],
  },
  {
    category: "Pollo a la brasa",
    items: [
      { name: "Cuarto de pollo", price: c(28) },
      { name: "Medio pollo", price: c(52) },
      { name: "Pollo entero", price: c(98) },
    ],
  },
  {
    category: "Acompañamientos",
    items: [
      { name: "Papas fritas", price: c(15), extras: [{ name: "Grande", priceCents: c(5) }] },
      { name: "Yuca frita", price: c(15) },
      { name: "Ensalada", price: c(12) },
    ],
  },
  {
    category: "Bebidas",
    items: [
      { name: "Coca-Cola 500 ml", price: c(8) },
      { name: "Limonada", price: c(10) },
      { name: "Cerveza nacional", price: c(18) },
    ],
  },
  { category: "Postres", items: [{ name: "Flan casero", price: c(12) }] },
];

/** Carga el menú de ejemplo. Devuelve false si el negocio ya tiene menú. */
export async function cargarMenuDemo(organizationId: string): Promise<boolean> {
  const actual = await leerMenu(organizationId);
  if (actual.items.length > 0) return false;
  for (const grupo of MENU_DEMO) {
    const categoryId = await crearCategoria(organizationId, grupo.category);
    for (const item of grupo.items) {
      await crearProducto(organizationId, {
        name: item.name,
        description: item.description,
        priceCents: item.price,
        categoryId,
        extras: item.extras,
      });
    }
  }
  return true;
}

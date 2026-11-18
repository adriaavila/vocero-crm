import { describe, expect, it } from "vitest";
import {
  avisoDeEstado,
  buscarPorNombre,
  disponible,
  finDelDia,
  precio,
  puedePasar,
  rechazoParaCliente,
  resolverPedido,
  resumenParaCliente,
  siguientePaso,
  type ProductoMenu,
} from "@/lib/restaurante/pedido";
import { momentosParaEnsenar } from "@/lib/ensenar";
import { agentActionSchema } from "@/server/ai/actions";
import { buildAllokNav } from "@/components/app-nav";

const AHORA = new Date("2026-11-18T00:30:00Z");

const MENU: ProductoMenu[] = [
  {
    id: "mit_doble",
    name: "Doble queso",
    priceCents: 4200,
    available: true,
    soldOutUntil: null,
    extras: [
      { id: "e1", name: "Sin cebolla", priceCents: 0, active: true },
      { id: "e2", name: "Extra queso", priceCents: 400, active: true },
      { id: "e3", name: "Tocino", priceCents: 600, active: false },
    ],
  },
  { id: "mit_papas", name: "Papas fritas", priceCents: 1500, available: true, soldOutUntil: null, extras: [] },
  { id: "mit_coca", name: "Coca-Cola 500 ml", priceCents: 800, available: true, soldOutUntil: null, extras: [] },
  {
    id: "mit_flan",
    name: "Flan casero",
    priceCents: 1200,
    available: true,
    soldOutUntil: new Date("2026-11-18T04:00:00Z"),
    extras: [],
  },
  { id: "mit_yuca", name: "Yuca frita", priceCents: 1500, available: false, soldOutUntil: null, extras: [] },
  { id: "mit_cuarto", name: "Cuarto de pollo", priceCents: 2800, available: true, soldOutUntil: null, extras: [] },
  { id: "mit_medio", name: "Medio pollo", priceCents: 5200, available: true, soldOutUntil: null, extras: [] },
];

describe("resolverPedido: el precio sale del menú", () => {
  it("arma las líneas con el precio del menú y suma los extras", () => {
    const r = resolverPedido(
      MENU,
      [
        { name: "doble queso", quantity: 2, extras: ["sin cebolla", "extra queso"] },
        { name: "PAPAS FRITAS", quantity: 1 },
        { name: "coca cola", quantity: 2 },
      ],
      AHORA
    );
    expect(r.rechazos).toEqual([]);
    expect(r.lineas.map((l) => [l.name, l.quantity, l.lineTotalCents])).toEqual([
      ["Doble queso", 2, 9200],
      ["Papas fritas", 1, 1500],
      ["Coca-Cola 500 ml", 2, 1600],
    ]);
    expect(r.subtotalCents).toBe(12300);
  });

  it("lo que no está en el menú no entra al pedido", () => {
    const r = resolverPedido(MENU, [{ name: "Pizza hawaiana", quantity: 1 }], AHORA);
    expect(r.lineas).toEqual([]);
    expect(r.rechazos).toEqual([{ name: "Pizza hawaiana", motivo: "no_esta" }]);
  });

  it("agotado por hoy y apagado se rechazan; mañana el agotado vuelve solo", () => {
    const pedido = [
      { name: "Flan casero", quantity: 1 },
      { name: "Yuca frita", quantity: 1 },
    ];
    expect(resolverPedido(MENU, pedido, AHORA).rechazos.map((x) => x.motivo)).toEqual(["agotado", "agotado"]);
    const manana = new Date("2026-11-18T15:00:00Z");
    expect(resolverPedido(MENU, pedido, manana).lineas.map((l) => l.name)).toEqual(["Flan casero"]);
  });

  it("un extra que no existe o está apagado rechaza la línea, no la cobra sin él", () => {
    const r = resolverPedido(
      MENU,
      [
        { name: "Doble queso", quantity: 1, extras: ["Tocino"] },
        { name: "Doble queso", quantity: 1, extras: ["Aguacate"] },
      ],
      AHORA
    );
    expect(r.lineas).toEqual([]);
    expect(r.rechazos.map((x) => x.extra)).toEqual(["Tocino", "Aguacate"]);
  });

  it("un nombre ambiguo no elige: «pollo» calza con dos productos", () => {
    expect(buscarPorNombre(MENU, "pollo")).toBeNull();
    expect(buscarPorNombre(MENU, "medio pollo")?.id).toBe("mit_medio");
    expect(buscarPorNombre(MENU, "coca")?.id).toBe("mit_coca");
  });

  it("la cantidad se acota: ni cero ni un millón", () => {
    const r = resolverPedido(
      MENU,
      [
        { name: "Papas fritas", quantity: 0 },
        { name: "Coca-Cola 500 ml", quantity: 100000 },
      ],
      AHORA
    );
    expect(r.lineas.map((l) => l.quantity)).toEqual([1, 50]);
  });
});

describe("estados del pedido", () => {
  it("solo avanza: de entregado no se vuelve a cocina", () => {
    expect(puedePasar("por_confirmar", "en_cocina", "envio")).toBe(true);
    expect(puedePasar("por_confirmar", "listo", "envio")).toBe(false);
    expect(puedePasar("entregado", "en_cocina", "envio")).toBe(false);
    expect(puedePasar("cancelado", "en_cocina", "envio")).toBe(false);
    expect(puedePasar("en_camino", "cancelado", "envio")).toBe(true);
  });

  it("un retiro salta «en camino»", () => {
    expect(siguientePaso("listo", "envio")).toBe("en_camino");
    expect(siguientePaso("listo", "retiro")).toBe("entregado");
    expect(siguientePaso("entregado", "retiro")).toBeNull();
  });
});

describe("lo que lee el cliente", () => {
  it("el resumen lleva los precios reales y no dice «confirmado»", () => {
    const { lineas, subtotalCents } = resolverPedido(
      MENU,
      [
        { name: "Doble queso", quantity: 2, extras: ["Sin cebolla"] },
        { name: "Coca-Cola 500 ml", quantity: 2 },
      ],
      AHORA
    );
    const texto = resumenParaCliente({ intro: null, lineas, subtotalCents, currency: "BOB", modalidad: "envio" });
    expect(texto).toContain("2 Doble queso (sin cebolla) · Bs 84");
    expect(texto).toContain("Subtotal Bs 100.");
    expect(texto).toContain("Una persona del local te confirma");
    expect(texto.toLowerCase()).not.toContain("confirmado");
  });

  it("el rechazo dice qué no hay", () => {
    expect(
      rechazoParaCliente([
        { name: "Flan casero", motivo: "agotado" },
        { name: "Pizza", motivo: "no_esta" },
      ])
    ).toBe("Te cuento: hoy no nos queda Flan casero; «Pizza» no está en nuestro menú. ¿Lo cambiamos por otra cosa del menú?");
  });

  it("cada paso avisa con el total; listo solo avisa en retiro", () => {
    const base = { totalCents: 12800, currency: "BOB", number: 1042 };
    expect(avisoDeEstado({ ...base, estado: "en_cocina", modalidad: "envio" })).toBe(
      "Confirmado tu pedido #1042. Total Bs 128, con el envío. Ya está en cocina."
    );
    expect(avisoDeEstado({ ...base, estado: "listo", modalidad: "envio" })).toBeNull();
    expect(avisoDeEstado({ ...base, estado: "listo", modalidad: "retiro" })).toContain("listo para retirar");
    expect(avisoDeEstado({ ...base, estado: "entregado", modalidad: "envio" })).toBeNull();
  });

  it("precio: decimales solo cuando hacen falta", () => {
    expect(precio(4200, "BOB")).toBe("Bs 42");
    expect(precio(1250, "USD")).toBe("$ 12.50");
  });
});

describe("los avisos de estado no son respuestas de una persona", () => {
  it("la bandeja no ofrece «Enséñaselo a tu agente» bajo un aviso del pedido", () => {
    const hilo = (respuesta: string) => [
      { id: "m1", direction: "in" as const, type: "text", text: "¿ya está mi pedido de medio pollo?", origin: null },
      { id: "m2", direction: "out" as const, type: "text", text: respuesta, origin: "operator" as const },
    ];
    expect(momentosParaEnsenar(hilo("Tu pedido #1003 está listo para retirar.")).size).toBe(0);
    expect(momentosParaEnsenar(hilo("Sí, en diez minutos lo tienes listo en caja.")).size).toBe(1);
  });
});

describe("disponibilidad", () => {
  it("«agotado por hoy» dura hasta la medianoche del negocio", () => {
    // 20:30 en La Paz (UTC-4) → faltan 3 h 30 min.
    expect(finDelDia(AHORA, "America/La_Paz").toISOString()).toBe("2026-11-18T04:00:00.000Z");
    expect(disponible({ available: true, soldOutUntil: finDelDia(AHORA, "America/La_Paz") }, AHORA)).toBe(false);
    expect(finDelDia(AHORA, "No/Existe").getTime() - AHORA.getTime()).toBe(24 * 3600 * 1000);
  });
});

describe("el agente y el módulo", () => {
  const pedido = { action: "prepare_order", items: [{ name: "Doble queso", quantity: 2 }] };

  it("solo un negocio que toma pedidos puede nombrar prepare_order", () => {
    expect(agentActionSchema(false, true).safeParse(pedido).success).toBe(true);
    expect(agentActionSchema(false).safeParse(pedido).success).toBe(false);
    expect(agentActionSchema(true).safeParse(pedido).success).toBe(false);
  });

  it("la acción no tiene dónde llevar un precio", () => {
    const parsed = agentActionSchema(false, true).parse({
      action: "prepare_order",
      items: [{ name: "Doble queso", quantity: 2, price: 1, unitPriceCents: 1 }],
      total: 5,
    });
    expect(JSON.stringify(parsed)).not.toMatch(/price|total/i);
  });

  it("Pedidos y Menú solo aparecen en un restaurante, después de Conversaciones", () => {
    expect(buildAllokNav(true, true).some((n) => n.href === "/pedidos")).toBe(false);
    const nav = buildAllokNav(true, true, false, "allok", true).map((n) => n.href);
    expect(nav.slice(0, 4)).toEqual(["/overview", "/inbox", "/pedidos", "/menu"]);
    expect(nav.at(-1)).toBe("/settings");
    expect(buildAllokNav(false, false, false, "allok", true).some((n) => n.href === "/menu")).toBe(false);
  });
});

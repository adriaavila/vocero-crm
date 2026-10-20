import { describe, expect, it } from "vitest";
import { calcularCuotas, type PlanPago } from "@/lib/sala-cuotas";
import { palabrasProhibidas } from "@/lib/sala-palabras";
import { PLANTILLA_SALA, componentesDeEnvio, textosPlantilla } from "@/lib/sala-plantilla";
import {
  LIMITE_TITULO_BOTON,
  confirmacionVisita,
  idBoton,
  leerAlquiler,
  leerBoton,
  linkSalaCompleta,
  mensajeCuota,
  pedirEnMonedaDeLaCasa,
  preguntaCuando,
  saludoWhatsapp,
  tarjetaCasa,
  type CasaWhatsapp,
} from "@/lib/sala-whatsapp";

const casa: CasaWhatsapp = {
  id: "prop_abc123",
  titulo: "Casa 4 · Santorini",
  precio: 120000,
  moneda: "USD",
  dormitorios: 3,
  banos: 2.5,
  superficie: 148.1,
  estado: "disponible",
};

const plan: PlanPago = {
  nombre: "Estándar",
  reserva: 3000,
  mesEntrega: 12,
  pasos: [
    { tipo: "unico", etiqueta: "Cuota inicial", porcentaje: 30, mes: 0 },
    { tipo: "mensual", etiqueta: "Cuota", porcentaje: 40, desdeMes: 1, hastaMes: 12 },
    { tipo: "unico", etiqueta: "Saldo contra entrega", porcentaje: 30, mes: 12 },
  ],
};

type Boton = { reply: { id: string; title: string } };
const botones = (m: { interactive: Record<string, unknown> }) =>
  ((m.interactive.action as { buttons: Boton[] }).buttons ?? []);

describe("ids de botón de la sala", () => {
  it("van y vuelven por Meta sin perder nada", () => {
    for (const b of [
      { accion: "visita", casaId: "prop_1" },
      { accion: "cuota", casaId: "prop_1" },
      { accion: "sinalquiler", casaId: "prop_1" },
      { accion: "cuando", casaId: "prop_1", cuando: "finde" },
    ] as const) {
      expect(leerBoton(idBoton(b))).toEqual(b);
    }
  });

  it("ignoran lo que no es de la sala", () => {
    expect(leerBoton(null)).toBeNull();
    expect(leerBoton("btn_3")).toBeNull();
    expect(leerBoton("Sí, me interesa")).toBeNull();
    expect(leerBoton("sala:comprar:prop_1")).toBeNull();
    expect(leerBoton("sala:cuando:prop_1:mañana")).toBeNull();
    expect(leerBoton("sala:visita:prop 1; drop")).toBeNull();
  });
});

describe("mensajes de la sala en WhatsApp", () => {
  it("la tarjeta lleva foto, precio, rasgos y dos botones dentro de los límites de Meta", () => {
    const t = tarjetaCasa(casa, { fotoUrl: "https://x.test/f.jpg", conCalculo: true, negocio: "Santorini" });
    expect(t.interactive.type).toBe("button");
    expect(t.interactive.header).toEqual({ type: "image", image: { link: "https://x.test/f.jpg" } });
    const cuerpo = (t.interactive.body as { text: string }).text;
    expect(cuerpo).toContain("US$ 120.000");
    expect(cuerpo).toContain("3 dorm. · 2,5 baños · 148,1 m²");
    expect(botones(t).map((b) => b.reply.title)).toEqual(["Quiero visitar", "Ver lo que pagaría"]);
    for (const b of botones(t)) expect(b.reply.title.length).toBeLessThanOrEqual(LIMITE_TITULO_BOTON);
    expect(t.texto).toContain("[Quiero visitar] [Ver lo que pagaría]");
  });

  it("sin plan aprobado no ofrece el cálculo", () => {
    const t = tarjetaCasa(casa, { fotoUrl: null, conCalculo: false, negocio: "" });
    expect(t.interactive.header).toBeUndefined();
    expect(botones(t)).toHaveLength(1);
  });

  it("el cálculo pregunta el alquiler cuando no lo sabe, y deja de preguntarlo cuando sí", () => {
    const sin = mensajeCuota({
      casa,
      calculo: calcularCuotas(casa.precio, plan, null),
      plan: { nombre: "Estándar", aprobadoPor: "Sergio" },
      imagenUrl: null,
      sabeAlquiler: false,
      negocio: "Santorini",
    });
    const cuerpoSin = (sin.interactive.body as { text: string }).text;
    expect(cuerpoSin).toContain("¿Cuánto pagas hoy de alquiler al mes, en dólares?");
    expect(cuerpoSin).toContain("12 × US$ 4.000");
    expect(botones(sin).map((b) => b.reply.title)).toEqual(["Quiero visitar", "No pago alquiler"]);

    const con = mensajeCuota({
      casa,
      calculo: calcularCuotas(casa.precio, plan, 2000),
      plan: { nombre: "Estándar", aprobadoPor: "Sergio" },
      imagenUrl: "https://x.test/cuota.png",
      sabeAlquiler: true,
      negocio: "Santorini",
    });
    const cuerpoCon = (con.interactive.body as { text: string }).text;
    expect(cuerpoCon).not.toContain("12 ×");
    expect(cuerpoCon).toContain("cubre el 50 % de tu cuota mensual de US$ 4.000");
    expect(cuerpoCon).not.toContain("¿Cuánto pagas");
    expect(botones(con)).toHaveLength(1);
  });

  it("nada de lo que lee el comprador usa palabras prohibidas", () => {
    const textos = [
      saludoWhatsapp("María José", 3, "Santorini"),
      tarjetaCasa(casa, { fotoUrl: null, conCalculo: true, negocio: "Santorini" }).texto,
      linkSalaCompleta("https://x.test/s/abc", "Santorini").texto,
      preguntaCuando(casa, "Santorini").texto,
      confirmacionVisita("semana", "Santorini", "https://x.test/s/abc").texto,
      confirmacionVisita("llamar", "Santorini", "https://x.test/s/abc").texto,
      pedirEnMonedaDeLaCasa(casa, "Santorini").texto,
      ...textosPlantilla(),
    ];
    for (const t of textos) expect(palabrasProhibidas(t), t).toEqual([]);
    expect(saludoWhatsapp("María José", 3, "Santorini")).toMatch(/^Hola, María\./);
  });
});

describe("leerAlquiler: cómo lo escribe la gente en Bolivia", () => {
  it.each([
    ["400", 400],
    ["2.500", 2500],
    ["2.500,50", 2500.5],
    ["1,200", 1200],
    ["350.5", 350.5],
    ["pago 450 al mes", 450],
    ["unos 500 dólares", 500],
    ["$us 600", 600],
  ])("«%s» → %d", (texto, monto) => {
    expect(leerAlquiler(texto, "USD")).toEqual({ monto });
  });

  it("avisa si lo dijo en bolivianos y la casa está en dólares", () => {
    expect(leerAlquiler("3.000 Bs", "USD")).toEqual({ otraMoneda: true });
    expect(leerAlquiler("3000 bolivianos", "BOB")).toEqual({ monto: 3000 });
  });

  it("lo que no es un monto lo deja para el agente", () => {
    expect(leerAlquiler("¿tienen casas de 2 dormitorios?", "USD")).toBeNull();
    expect(leerAlquiler("tengo 3 hijos", "USD")).toBeNull();
    expect(leerAlquiler("hola", "USD")).toBeNull();
    expect(leerAlquiler("0", "USD")).toBeNull();
  });
});

describe("plantilla de reactivación (borrador)", () => {
  it("cumple los límites de Meta", () => {
    const body = PLANTILLA_SALA.components.find((c) => c.type === "BODY")!;
    expect(body.text.length).toBeLessThanOrEqual(1024);
    // Meta rechaza un cuerpo que empieza o termina con variable.
    expect(body.text.trim().startsWith("{{")).toBe(false);
    expect(body.text.trim().endsWith("}}")).toBe(false);
    const btns = PLANTILLA_SALA.components.find((c) => c.type === "BUTTONS")!.buttons;
    for (const b of btns) expect(b.text.length).toBeLessThanOrEqual(25);
  });

  it("sus respuestas rápidas caen en los mismos botones de la sala", () => {
    const comps = componentesDeEnvio({ nombre: "María", novedad: "Abrimos visitas los sábados.", fotoUrl: "https://x.test/f.jpg", token: "tok", casaId: "prop_1" });
    const payloads = comps
      .filter((c) => c.type === "button" && "sub_type" in c && c.sub_type === "quick_reply")
      .map((c) => (c.parameters[0] as { payload: string }).payload);
    expect(payloads.map(leerBoton)).toEqual([
      { accion: "cuota", casaId: "prop_1" },
      { accion: "visita", casaId: "prop_1" },
    ]);
  });
});

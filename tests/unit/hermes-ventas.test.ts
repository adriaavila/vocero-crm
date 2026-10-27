import { afterEach, describe, expect, it, vi } from "vitest";
import { sugerenciasVentas, textoReporteVentas, SUGERENCIAS_MAX, type DatosVentas } from "@/lib/hermes-ventas";

/** Una semana tranquila: nada dispara sugerencias hasta que el caso lo pida. */
function base(over: Partial<DatosVentas> = {}): DatosVentas {
  return {
    negocio: "SAMER",
    zona: "America/La_Paz",
    desde: "2026-10-20",
    hasta: "2026-10-26",
    dias: 7,
    agenteEncendido: true,
    periodo: { conversaciones: 3, leadsNuevos: 2, respondioAgente: 10, respondieronPersonas: 1 },
    anterior: { conversaciones: 1, leadsNuevos: 1 },
    ventas: { cerradas: 0, cents: 0, moneda: "USD" },
    embudo: [],
    casas: [],
    visitas: { proximas: [{ cuando: "2026-10-28 10:00", contacto: "Ana", casa: "V2" }], realizadas: 0, noShow: 0, sinResultado: [], interesados: 0, quierenNegociar: 0, listos: [] },
    teEsperan: { total: 0, ventanaCerrada: 0, principales: [] },
    noSupoResponder: [],
    pidieronPersona: 0,
    laboratorio: null,
    fallosMarcados: 0,
    ...over,
  };
}

const claves = (d: DatosVentas) => sugerenciasVentas(d).map((s) => s.clave);

describe("sugerenciasVentas", () => {
  it("una semana sin nada raro no inventa consejos", () => {
    expect(claves(base())).toEqual([]);
  });

  it("primero a quién llamar: es lo que está más cerca de una reserva", () => {
    const d = base({
      agenteEncendido: false,
      visitas: { ...base().visitas, listos: [{ cuando: "2026-10-24 10:00", contacto: "Ana", casa: "V2" }] },
      noSupoResponder: [{ contacto: "Caro", pregunta: "¿hay estacionamiento?" }],
    });
    expect(claves(d).slice(0, 3)).toEqual(["llamar_hoy", "agente_apagado", "ensenar"]);
    expect(sugerenciasVentas(d)[0]!.texto).toContain("Ana");
  });

  it("agente apagado: dice qué falta para encenderlo, con la nota del Laboratorio", () => {
    const bajo = sugerenciasVentas(base({ agenteEncendido: false, laboratorio: { score: 17, cuando: "" } }))[0]!;
    expect(bajo.texto).toContain("80 o más (la última: 17)");
    const listo = sugerenciasVentas(base({ agenteEncendido: false, laboratorio: { score: 86, cuando: "" } }))[0]!;
    expect(listo.texto).toContain("ya se puede encender");
    // Sin clientes no hay apuro.
    expect(claves(base({ agenteEncendido: false, periodo: { ...base().periodo, conversaciones: 0 } }))).not.toContain("agente_apagado");
  });

  it("casas quietas solo cuando otra sí se mueve (si ninguna se mueve, el problema es otro)", () => {
    const casa = (titulo: string, consultas: number) => ({ titulo, estado: "disponible" as const, precioCents: 1, moneda: "USD", consultas, visitas: 0 });
    expect(claves(base({ casas: [casa("V2", 6), casa("V5", 0)] }))).toContain("casas_quietas");
    expect(claves(base({ casas: [casa("V2", 0), casa("V5", 0)] }))).not.toContain("casas_quietas");
  });

  it("sin visitas próximas con gente escribiendo, pide ofrecer visita", () => {
    const d = base({ periodo: { ...base().periodo, conversaciones: 9 }, visitas: { ...base().visitas, proximas: [] } });
    expect(claves(d)).toContain("sin_visitas");
  });
});

describe("textoReporteVentas", () => {
  const d = base({
    ventas: { cerradas: 1, cents: 12_000_000, moneda: "USD" },
    casas: [
      { titulo: "V1", estado: "cerrada", precioCents: 1, moneda: "USD", consultas: 0, visitas: 0 },
      { titulo: "V2", estado: "disponible", precioCents: 1, moneda: "USD", consultas: 6, visitas: 2 },
      { titulo: "V5", estado: "disponible", precioCents: 1, moneda: "USD", consultas: 0, visitas: 0 },
      { titulo: "V6", estado: "disponible", precioCents: 1, moneda: "USD", consultas: 0, visitas: 0 },
    ],
    teEsperan: { total: 1, ventanaCerrada: 0, principales: [{ nombre: "Jorge <M>", razon: "Pidió una persona", ventana: "Quedan 5 h" }] },
  });

  it("WhatsApp: negrita con asteriscos, casas quietas y vendidas en una línea", () => {
    const t = textoReporteVentas(d, sugerenciasVentas(d));
    expect(t.split("\n")[0]).toBe("*SAMER · ventas*");
    expect(t).toContain("20 oct al 26 oct");
    expect(t).toContain("1 venta cerrada");
    expect(t).toContain("🟢 V2 · 6 consultas · 2 visitas");
    expect(t).toContain("⚪ Sin consultas: V5, V6");
    expect(t).toContain("⚫ Vendidas: V1");
    expect(t).toContain("• Jorge <M> · pidió una persona · quedan 5 h");
    expect(t).toContain("• 28 oct, 10:00 · Ana · V2");
  });

  it("Telegram: HTML, con el texto del negocio escapado", () => {
    const t = textoReporteVentas(d, sugerenciasVentas(d), "telegram");
    expect(t.split("\n")[0]).toBe("<b>SAMER · ventas</b>");
    expect(t).toContain("Jorge &lt;M&gt;");
    expect(t).not.toContain("*");
  });

  it("muestra a lo más las primeras sugerencias", () => {
    const muchas = base({
      agenteEncendido: false,
      periodo: { ...base().periodo, conversaciones: 9 },
      visitas: { ...base().visitas, proximas: [], listos: [{ cuando: "x", contacto: "Ana", casa: null }], sinResultado: [{ cuando: "x", contacto: "Beto", casa: null }] },
      noSupoResponder: [{ contacto: "C", pregunta: "¿?" }],
      teEsperan: { total: 2, ventanaCerrada: 3, principales: [] },
      fallosMarcados: 2,
    });
    const s = sugerenciasVentas(muchas);
    expect(s.length).toBeGreaterThan(SUGERENCIAS_MAX);
    const t = textoReporteVentas(muchas, s);
    expect(t).toContain(`${SUGERENCIAS_MAX}. `);
    expect(t).not.toContain(`${SUGERENCIAS_MAX + 1}. `);
  });
});

describe("GET /api/hermes/ventas", () => {
  afterEach(() => {
    delete process.env.HERMES_API_KEY;
    vi.resetModules();
  });

  async function llamar(headers: Record<string, string>, qs = "negocio=samer") {
    vi.doMock("@/server/agencia/hermes-ventas", () => ({
      HERMES_PERIODOS: ["7d", "30d"],
      resolverNegocio: async (n: string) => (n === "samer" ? "org_samer" : null),
      reporteVentas: async (org: string, o: { formato: string }) => ({ texto: `${org}:${o.formato}`, sugerencias: [], datos: {} }),
    }));
    vi.doMock("@/server/bot/auth", () => ({ resolveInstanceOrg: async () => "org_instancia" }));
    const { GET } = await import("@/app/api/hermes/ventas/route");
    return GET(new Request(`http://x/api/hermes/ventas?${qs}`, { headers }));
  }

  it("sin HERMES_API_KEY la superficie no existe", async () => {
    expect((await llamar({ "x-api-key": "lo-que-sea-largo-123" })).status).toBe(404);
  });

  it("con la llave equivocada, 401; con la buena, el reporte", async () => {
    process.env.HERMES_API_KEY = "k".repeat(32);
    expect((await llamar({ "x-api-key": "k".repeat(31) })).status).toBe(401);
    const ok = await llamar({ "x-api-key": "k".repeat(32) }, "negocio=samer&formato=telegram");
    expect(ok.status).toBe(200);
    expect((await ok.json()).texto).toBe("org_samer:telegram");
    expect((await llamar({ "x-api-key": "k".repeat(32) }, "negocio=nadie")).status).toBe(404);
    // Sin `negocio`: el de la instancia.
    expect((await (await llamar({ "x-api-key": "k".repeat(32) }, "")).json()).texto).toBe("org_instancia:whatsapp");
    expect((await llamar({ "x-api-key": "k".repeat(32) }, "negocio=samer&periodo=1y")).status).toBe(400);
  });
});

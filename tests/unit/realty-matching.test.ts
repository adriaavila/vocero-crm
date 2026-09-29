import { describe, expect, it } from "vitest";
import {
  compareMatches,
  isEligibleProperty,
  rankProperties,
  scoreProperty,
  type PropertyInput,
  type RequirementInput,
} from "@/server/realty/matching";

/**
 * Portado sin cambios de lógica desde el fork inmobiliario
 * (`vocero-inmobiliario-main`, `tests/unit/matching.test.ts`) — renombrado a
 * `realty-matching.test.ts` para no chocar con un `matching.test.ts` futuro
 * de otro dominio en este repo.
 */

/** Propiedad base: departamento disponible en Equipetrol, Santa Cruz, 300k USD. */
function prop(overrides: Partial<PropertyInput> = {}): PropertyInput {
  return {
    id: "prp_base",
    operation: "venta",
    kind: "departamento",
    price: "300000",
    currency: "USD",
    neighborhood: "Equipetrol",
    city: "Santa Cruz",
    bedrooms: 2,
    bathrooms: "2",
    amenities: [],
    acceptedPayments: [],
    status: "disponible",
    archivedAt: null,
    ...overrides,
  };
}

describe("scoreProperty — presupuesto", () => {
  it("dentro del rango puntúa completo", () => {
    const req: RequirementInput = { budgetMin: 200000, budgetMax: 350000 };
    const { score, reasons } = scoreProperty(req, prop());
    expect(score).toBe(100);
    expect(reasons[0]).toMatchObject({
      criterion: "presupuesto",
      fit: "full",
      label: "Dentro de presupuesto",
    });
  });

  it("dentro del ±15 % puntúa medio — es la única relajación gradual", () => {
    // 300,000 contra un techo de 270,000: sobra 11 %, cae en la tolerancia.
    const req: RequirementInput = { budgetMax: 270000 };
    const { score, reasons } = scoreProperty(req, prop());
    expect(score).toBe(50);
    expect(reasons[0]?.fit).toBe("partial");
    expect(reasons[0]?.label).toBe("Cerca del presupuesto");
  });

  it("fuera de la tolerancia puntúa cero", () => {
    const req: RequirementInput = { budgetMax: 200000 };
    const { score, reasons } = scoreProperty(req, prop());
    expect(score).toBe(0);
    expect(reasons[0]?.label).toBe("Fuera de presupuesto");
  });

  it("no compara monedas distintas: el criterio no aplica en vez de inventar", () => {
    const req: RequirementInput = { budgetMax: 1400000, currency: "BOB" };
    const { score, reasons } = scoreProperty(
      req,
      prop({ currency: "USD", price: "180000" })
    );
    // Sin criterios aplicables → neutral, y ningún chip de presupuesto.
    expect(score).toBe(50);
    expect(reasons).toHaveLength(0);
  });
});

describe("scoreProperty — zona", () => {
  it("empata sin acentos ni mayúsculas", () => {
    const req: RequirementInput = { zones: "urubo" };
    const { score } = scoreProperty(
      req,
      prop({ neighborhood: "Urubó", city: "Santa Cruz" })
    );
    expect(score).toBe(100);
  });

  it("basta que UNA de las zonas separadas por coma o diagonal coincida", () => {
    expect(scoreProperty({ zones: "Sirari, Equipetrol" }, prop()).score).toBe(100);
    expect(scoreProperty({ zones: "Sirari/Equipetrol" }, prop()).score).toBe(100);
  });

  it("el chip muestra la zona de la propiedad, no la pedida", () => {
    const { reasons } = scoreProperty({ zones: "Sirari" }, prop());
    expect(reasons[0]).toMatchObject({ fit: "none", label: "Zona: Equipetrol, Santa Cruz" });
  });
});

describe("scoreProperty — recámaras y baños", () => {
  it("más recámaras de las pedidas cumple completo", () => {
    expect(scoreProperty({ minBedrooms: 2 }, prop({ bedrooms: 3 })).score).toBe(100);
  });

  it("una recámara menos es casi-match (medio punto)", () => {
    const { score, reasons } = scoreProperty({ minBedrooms: 3 }, prop({ bedrooms: 2 }));
    expect(score).toBe(50);
    expect(reasons[0]?.fit).toBe("partial");
  });

  it("dos recámaras menos no cumple", () => {
    expect(scoreProperty({ minBedrooms: 4 }, prop({ bedrooms: 2 })).score).toBe(0);
  });

  it("una propiedad sin el dato no cumple el mínimo pedido", () => {
    expect(scoreProperty({ minBedrooms: 2 }, prop({ bedrooms: null })).score).toBe(0);
  });

  it("los medios baños cuentan", () => {
    expect(
      scoreProperty({ minBathrooms: "1.5" }, prop({ bathrooms: "1.5" })).score
    ).toBe(100);
    expect(
      scoreProperty({ minBathrooms: "2" }, prop({ bathrooms: "1.5" })).score
    ).toBe(0);
  });
});

describe("scoreProperty — amenidades y forma de pago", () => {
  it("todas las amenidades pedidas presentes = completo", () => {
    const { score } = scoreProperty(
      { amenities: ["alberca", "seguridad"] },
      prop({ amenities: ["alberca", "seguridad", "gimnasio"] })
    );
    expect(score).toBe(100);
  });

  it("al menos la mitad = medio punto", () => {
    const { score, reasons } = scoreProperty(
      { amenities: ["alberca", "seguridad"] },
      prop({ amenities: ["alberca"] })
    );
    expect(score).toBe(50);
    expect(reasons[0]?.label).toBe("1 de 2 amenidades");
  });

  it("Infonavit contra una propiedad que no lo acepta puntúa cero", () => {
    const { score, reasons } = scoreProperty(
      { paymentMethod: "infonavit" },
      prop({ acceptedPayments: ["contado", "credito_bancario"] })
    );
    expect(score).toBe(0);
    expect(reasons[0]?.label).toBe("No acepta Infonavit");
  });

  it("Infonavit contra una propiedad que sí lo acepta puntúa completo", () => {
    const { reasons } = scoreProperty(
      { paymentMethod: "infonavit" },
      prop({ acceptedPayments: ["infonavit"] })
    );
    expect(reasons[0]).toMatchObject({ fit: "full", label: "Acepta Infonavit" });
  });

  it("si la propiedad no declara formas de pago, el criterio no aplica", () => {
    // No hay información: castigar escondería inventario válido.
    const { score, reasons } = scoreProperty({ paymentMethod: "infonavit" }, prop());
    expect(score).toBe(50);
    expect(reasons).toHaveLength(0);
  });
});

describe("scoreProperty — reglas de borde", () => {
  it("sin ningún criterio declarado el score es 50 (neutral)", () => {
    const { score, reasons } = scoreProperty({}, prop());
    expect(score).toBe(50);
    expect(reasons).toHaveLength(0);
  });

  it("los criterios vacíos no entran al denominador", () => {
    // Solo el tipo está declarado y coincide → 100, pese a que el lead no dijo
    // nada de presupuesto, zona, recámaras ni baños.
    const { score, reasons } = scoreProperty({ kind: "departamento" }, prop());
    expect(score).toBe(100);
    expect(reasons).toHaveLength(1);
  });

  it("combina criterios: 2 de 3 completos y uno a cero", () => {
    const { score } = scoreProperty(
      { kind: "departamento", zones: "Equipetrol", minBedrooms: 4 },
      prop()
    );
    // (1 + 1 + 0) / 3 = 66.67 → 67
    expect(score).toBe(67);
  });
});

describe("prefiltro — igual en ambas direcciones", () => {
  it("excluye archivadas", () => {
    expect(isEligibleProperty({}, prop({ archivedAt: new Date() }))).toBe(false);
  });

  it("excluye apartadas y cerradas, no solo en la dirección directa", () => {
    expect(isEligibleProperty({}, prop({ status: "apartada" }))).toBe(false);
    expect(isEligibleProperty({}, prop({ status: "cerrada" }))).toBe(false);
    expect(isEligibleProperty({}, prop({ status: "disponible" }))).toBe(true);
  });

  it("respeta la operación cuando el lead la declaró", () => {
    expect(isEligibleProperty({ operation: "renta" }, prop())).toBe(false);
    expect(isEligibleProperty({ operation: "venta" }, prop())).toBe(true);
    // Sin operación declarada, no filtra.
    expect(isEligibleProperty({}, prop())).toBe(true);
  });
});

describe("ranking", () => {
  it("desempata por precio ascendente y luego por id — orden estable", () => {
    const cara = prop({ id: "prp_b", price: "500000" });
    const barata = prop({ id: "prp_a", price: "100000" });
    const a = { score: 80, property: cara };
    const b = { score: 80, property: barata };
    expect(compareMatches(a, b)).toBeGreaterThan(0);
    expect(compareMatches(b, a)).toBeLessThan(0);

    const mismoPrecio1 = { score: 80, property: prop({ id: "prp_a" }) };
    const mismoPrecio2 = { score: 80, property: prop({ id: "prp_b" }) };
    expect(compareMatches(mismoPrecio1, mismoPrecio2)).toBeLessThan(0);
  });

  it("rankProperties filtra, puntúa, ordena y recorta", () => {
    const req: RequirementInput = { kind: "departamento", zones: "Equipetrol" };
    const candidatas = [
      prop({ id: "prp_1", kind: "casa" }), // 50: zona sí, tipo no
      prop({ id: "prp_2" }), // 100
      prop({ id: "prp_3", status: "apartada" }), // fuera del prefiltro
      prop({ id: "prp_4", neighborhood: "Sirari" }), // 50: tipo sí, zona no
    ];
    const ranked = rankProperties(req, candidatas);
    expect(ranked.map((r) => r.property.id)).toEqual(["prp_2", "prp_1", "prp_4"]);
    expect(ranked[0]?.score).toBe(100);
    expect(rankProperties(req, candidatas, 2)).toHaveLength(2);
  });

  it("sin coincidencias devuelve lista vacía, nunca un resultado inventado", () => {
    const ranked = rankProperties({ operation: "renta" }, [prop()]);
    expect(ranked).toEqual([]);
  });
});

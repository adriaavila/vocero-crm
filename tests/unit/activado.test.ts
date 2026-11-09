import { describe, expect, it } from "vitest";
import { activatedAtFromMetadata, everActivatedFrom } from "@/lib/activado";

describe("everActivated sin migración", () => {
  const meta = (allok: unknown) => JSON.stringify({ stripe: 1, allok });
  it("lee metadata.allok.activatedAt", () => {
    expect(activatedAtFromMetadata(meta({ activatedAt: "2026-11-01T00:00:00.000Z", billing: {} }))).toBe("2026-11-01T00:00:00.000Z");
    expect(activatedAtFromMetadata(meta({ billing: {} }))).toBeNull();
    expect(activatedAtFromMetadata(null)).toBeNull();
    expect(activatedAtFromMetadata("{no es json")).toBeNull();
    expect(activatedAtFromMetadata(meta({ activatedAt: 5 }))).toBeNull();
  });
  it("un negocio nuevo no activó nunca", () => {
    expect(everActivatedFrom({ enabled: false, metadata: meta({ billing: {} }), hasRealAiOutbound: false })).toBe(false);
  });
  it("cualquiera de las tres señales basta", () => {
    expect(everActivatedFrom({ enabled: true, metadata: null, hasRealAiOutbound: false })).toBe(true);
    expect(everActivatedFrom({ enabled: false, metadata: meta({ activatedAt: "x" }), hasRealAiOutbound: false })).toBe(true);
    // negocio anterior a la marca: el agente ya le contestó a un cliente de verdad
    expect(everActivatedFrom({ enabled: false, metadata: null, hasRealAiOutbound: true })).toBe(true);
  });
});

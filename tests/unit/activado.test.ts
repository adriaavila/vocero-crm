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

import { vi } from "vitest";
import { ACTIVATED_MARK_CUTOFF, DEMO_WAMID_LIKE, resolveEverActivated } from "@/lib/activado";

describe("resolveEverActivated", () => {
  const before = new Date("2026-09-01T00:00:00Z");
  const after = new Date("2026-11-12T00:00:00Z");
  const deps = (over: Partial<Parameters<typeof resolveEverActivated>[0]> = {}) => ({
    enabled: false,
    metadata: null,
    createdAt: after,
    hasRealAiOutbound: vi.fn(async () => true),
    mark: vi.fn(async () => {}),
    ...over,
  });

  it("encendido hoy y sin marca: se auto-repara escribiéndola", async () => {
    const d = deps({ enabled: true });
    expect(await resolveEverActivated(d)).toBe(true);
    expect(d.mark).toHaveBeenCalledTimes(1);
  });
  it("si escribir falla no rompe la lectura", async () => {
    const onMarkError = vi.fn();
    const d = deps({ enabled: true, mark: vi.fn(async () => { throw new Error("db"); }), onMarkError });
    expect(await resolveEverActivated(d)).toBe(true);
    expect(onMarkError).toHaveBeenCalled();
  });
  it("con la marca no escribe ni consulta nada", async () => {
    const d = deps({ enabled: true, metadata: JSON.stringify({ allok: { activatedAt: "x" } }) });
    expect(await resolveEverActivated(d)).toBe(true);
    expect(d.mark).not.toHaveBeenCalled();
    expect(d.hasRealAiOutbound).not.toHaveBeenCalled();
  });
  it("corte: un negocio nuevo no infiere por mensajes (la demo no lo saca de la alta)", async () => {
    const d = deps({ createdAt: after });
    expect(await resolveEverActivated(d)).toBe(false);
    expect(d.hasRealAiOutbound).not.toHaveBeenCalled();
    expect(after > ACTIVATED_MARK_CUTOFF).toBe(true);
  });
  it("un negocio anterior al corte sí infiere por mensajes de IA reales", async () => {
    expect(await resolveEverActivated(deps({ createdAt: before }))).toBe(true);
    expect(await resolveEverActivated(deps({ createdAt: before, hasRealAiOutbound: vi.fn(async () => false) }))).toBe(false);
  });
  it("los wamid de la demo se excluyen", () => expect(DEMO_WAMID_LIKE).toBe("wamid.demo.%"));
});

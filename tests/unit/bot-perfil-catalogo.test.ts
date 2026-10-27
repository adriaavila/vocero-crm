import { describe, expect, it, vi } from "vitest";

const { catalogo } = vi.hoisted(() => ({ catalogo: vi.fn() }));
vi.mock("@/server/agencia/catalogo-agente", () => ({ catalogoParaPrompt: catalogo }));

import { REGLAS_DE_LA_CASA, conocimientoDeAgencia } from "@/server/agencia/bot-perfil";

/** El cerebro externo recibe el catálogo y las reglas de la casa en un negocio inmobiliario. */
describe("conocimientoDeAgencia", () => {
  const base = { instructions: "Eres el asistente de SAMER.", kb: "P: ¿Dónde están?\nR: Tarija" };

  it("sin catálogo (allok, o sin propiedades) el perfil queda igual", async () => {
    catalogo.mockResolvedValueOnce(null);
    expect(await conocimientoDeAgencia("org_1", base)).toEqual(base);
  });

  it("con catálogo, lo suma al conocimiento y las reglas a las instrucciones", async () => {
    catalogo.mockResolvedValueOnce("CATÁLOGO…\n- «Casa 8» · 85.000 USD");
    const out = await conocimientoDeAgencia("org_1", base);
    expect(out.kb).toBe(`${base.kb}\n\nCATÁLOGO…\n- «Casa 8» · 85.000 USD`);
    expect(out.instructions).toBe(`${base.instructions}\n\n${REGLAS_DE_LA_CASA}`);
  });
});

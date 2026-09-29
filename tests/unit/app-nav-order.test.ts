import { describe, expect, it } from "vitest";
import { buildAllokNav } from "@/components/app-nav";

/**
 * Decisión de Adrian: en el nav allok, Configuración va AL FINAL de todo —
 * después de Ventas/Resultados/Agenda/Equipo cuando hay Pro, y sola al final
 * cuando no lo hay. Nada de esto se ve renderizando el componente (necesita
 * sesión, hooks, SSE…), así que se prueba la función pura que arma la lista.
 */
describe("buildAllokNav", () => {
  it("sin Pro, Configuración sigue siendo la última", () => {
    const nav = buildAllokNav(false, false);
    expect(nav.at(-1)?.href).toBe("/settings");
  });

  it("con Pro, Configuración va después de Ventas, Resultados y Equipo", () => {
    const nav = buildAllokNav(true, true);
    expect(nav.at(-1)?.href).toBe("/settings");
    const hrefs = nav.map((n) => n.href);
    expect(hrefs.indexOf("/settings")).toBeGreaterThan(hrefs.indexOf("/pipeline"));
    expect(hrefs.indexOf("/settings")).toBeGreaterThan(hrefs.indexOf("/results"));
    expect(hrefs.indexOf("/settings")).toBeGreaterThan(hrefs.indexOf("/settings/team"));
  });

  it("con Pro pero sin AGENDA, Agenda no aparece y Configuración sigue al final", () => {
    const nav = buildAllokNav(true, false);
    expect(nav.some((n) => n.href === "/bookings")).toBe(false);
    expect(nav.at(-1)?.href).toBe("/settings");
  });

  it("Configuración no se repite", () => {
    const nav = buildAllokNav(true, true);
    expect(nav.filter((n) => n.href === "/settings")).toHaveLength(1);
  });

  // Vertical inmobiliario (parte 1): "Propiedades" es por ORGANIZACIÓN
  // (organization.metadata.vertical), no de instancia como Agenda — de ahí
  // el tercer parámetro aparte de `pro`.
  it("sin el tercer parámetro, Propiedades no aparece (default false)", () => {
    const nav = buildAllokNav(true, true);
    expect(nav.some((n) => n.href === "/properties")).toBe(false);
  });

  it("con Pro y el vertical activo, Propiedades aparece entre Ventas y Resultados", () => {
    const nav = buildAllokNav(true, true, true);
    const hrefs = nav.map((n) => n.href);
    expect(hrefs).toContain("/properties");
    expect(hrefs.indexOf("/properties")).toBeGreaterThan(hrefs.indexOf("/pipeline"));
    expect(hrefs.indexOf("/properties")).toBeLessThan(hrefs.indexOf("/results"));
  });

  it("con el vertical activo pero SIN Pro, Propiedades tampoco aparece", () => {
    const nav = buildAllokNav(false, true, true);
    expect(nav.some((n) => n.href === "/properties")).toBe(false);
  });

  it("Propiedades y Agenda son independientes entre sí", () => {
    const soloPropiedades = buildAllokNav(true, false, true);
    expect(soloPropiedades.some((n) => n.href === "/properties")).toBe(true);
    expect(soloPropiedades.some((n) => n.href === "/bookings")).toBe(false);
  });
});

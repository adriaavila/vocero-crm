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
});

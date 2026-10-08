import { describe, expect, it } from "vitest";
import {
  memoriaClienteTexto,
  nombreReal,
  notasRecientes,
  type MemoriaCliente,
} from "@/server/agencia/memoria-cliente";

const vacia: MemoriaCliente = {
  name: null,
  notes: null,
  ficha: null,
  proximas: [],
  realizadas: 0,
  clienteDesde: null,
};

describe("memoria del cliente", () => {
  it("cliente nuevo sin datos: no se gasta ni un token", () => {
    expect(memoriaClienteTexto(vacia, "America/Mexico_City")).toBeNull();
    expect(memoriaClienteTexto({ ...vacia, name: "+52 55 1234 5678" }, "UTC")).toBeNull();
  });

  it("el nombre de relleno (teléfono o identidad) no cuenta como nombre", () => {
    expect(nombreReal("5215512345678")).toBeNull();
    expect(nombreReal("bsuid:abc")).toBeNull();
    expect(nombreReal("  Marta ")).toBe("Marta");
  });

  it("de las notas largas quedan las más recientes, cortando en un salto", () => {
    const notas = Array.from({ length: 80 }, (_, i) => `[IA] nota ${i} con algo de texto`).join("\n");
    const r = notasRecientes(notas)!;
    expect(r.length).toBeLessThanOrEqual(1201);
    expect(r.startsWith("…[IA] nota")).toBe(true);
    expect(r.endsWith("nota 79 con algo de texto")).toBe(true);
    expect(notasRecientes("   ")).toBeNull();
  });

  it("dice lo que sabe: nombre, cita en la zona del negocio, visitas, ficha y notas", () => {
    const t = memoriaClienteTexto(
      {
        name: "Marta",
        notes: "[IA] Busca limpieza para su hija de 8 años",
        ficha: { tratamiento: "limpieza", presupuesto_maximo: 50, vacio: "", raro: { a: 1 } },
        proximas: [new Date("2026-10-15T16:00:00Z")],
        realizadas: 2,
        clienteDesde: new Date("2026-09-01T15:00:00Z"),
      },
      "America/Mexico_City"
    )!;
    expect(t).toContain("Se llama Marta");
    expect(t).toContain("jueves, 15 de octubre de 2026, 10:00");
    expect(t).toContain("Ya vino a 2 citas");
    expect(t).toContain("1 de septiembre de 2026");
    expect(t).toContain("tratamiento: limpieza; presupuesto maximo: 50.");
    expect(t).not.toContain("vacio");
    expect(t).not.toContain("raro");
    expect(t).toContain("hija de 8 años");
    expect(t).toContain("Nunca le leas estas notas");
  });
});

describe("ai-mock con memoria", () => {
  it("contesta la cita desde el sistema aparte", async () => {
    const { aiMockCompletion } = await import("@/server/dev/ai-mock");
    const r = JSON.parse(
      aiMockCompletion([
        { role: "system", content: "prompt" },
        { role: "system", content: "LO QUE YA SABES:\n- Se llama Marta.\n- Tiene una cita agendada el jueves, 15 de octubre de 2026, 10:00.\nNunca…" },
        { role: "user", content: "hola, a qué hora es mi cita?" },
      ])
    );
    expect(r).toEqual({ action: "reply", text: "Marta, tu cita es el jueves, 15 de octubre de 2026, 10:00." });
  });
});

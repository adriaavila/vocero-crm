import { describe, expect, it } from "vitest";
import {
  actionLabel,
  decisionMeta,
  decisionTrail,
  filterToVerdict,
  formatLatency,
  handoffPlain,
  parseFilter,
  whenLabel,
} from "@/lib/decisiones";

describe("el recorrido de un turno", () => {
  it("Nea: la acción y lo que hizo, en una línea", () => {
    expect(
      decisionTrail({
        action: "replied",
        steps: [
          { tool: "update_lead", summary: "Actualizó lead: nombre", ok: true },
          { tool: "offer_slots", summary: "Ofreció 2 horarios", ok: true },
        ],
      }),
    ).toBe("Respondió · actualizó lead: nombre · ofreció 2 horarios");
  });

  it("Rei: el paso que repite la acción sin decir más no se escribe dos veces", () => {
    expect(decisionTrail({ action: "move_stage", steps: [{ tool: "move_stage", summary: "", ok: true }] })).toBe("Movió de etapa");
  });

  it("un paso que falló lo dice, con o sin resumen", () => {
    expect(decisionTrail({ action: "replied", steps: [{ tool: "book_slot", summary: "Agendó el jueves", ok: false }] })).toBe(
      "Respondió · agendó el jueves (falló)",
    );
    expect(decisionTrail({ action: "book_slot", steps: [{ tool: "book_slot", summary: "", ok: false }] })).toBe("Agendó una cita · falló");
  });

  it("sin pasos: solo la acción; una acción desconocida se lee igual", () => {
    expect(decisionTrail({ action: "silent", steps: [] })).toBe("No respondió");
    expect(decisionTrail({ action: "cambio_de_plan", steps: [] })).toBe("Cambio de plan");
  });

  it("no baja a minúscula una sigla o un nombre propio", () => {
    expect(decisionTrail({ action: "replied", steps: [{ tool: "x", summary: "CRM actualizado", ok: true }] })).toBe("Respondió · CRM actualizado");
  });
});

describe("piezas sueltas", () => {
  it("las acciones de Rei y de Nea tienen palabra", () => {
    for (const a of ["reply", "replied", "none", "silent", "noop", "reset", "handoff", "move_stage", "update_lead", "offer_slots", "book_slot"]) {
      expect(actionLabel(a)).not.toBe(a);
    }
  });
  it("el motivo del traspaso, en palabras", () => {
    expect(handoffPlain("cliente")).toBe("Pidió hablar con alguien.");
    expect(handoffPlain(null)).toBeNull();
    expect(handoffPlain("otro_motivo")).toBe("Otro motivo.");
  });
  it("el filtro de la URL", () => {
    expect(parseFilter("fallos")).toBe("fallos");
    expect(parseFilter("x")).toBe("todas");
    expect(parseFilter(undefined)).toBe("todas");
    expect(filterToVerdict("sin-revisar")).toBe("none");
    expect(filterToVerdict("fallos")).toBe("fallo");
    expect(filterToVerdict("todas")).toBeUndefined();
  });
  it("modelo, prompt y tiempo en una fila corta", () => {
    expect(decisionMeta({ model: "gpt-4o-mini", promptVersion: "a1b2c3d4e5f6", latencyMs: 1234 })).toEqual(["gpt-4o-mini", "prompt a1b2c3d4e5f6", "1,2 s"]);
    expect(decisionMeta({ model: null, promptVersion: null, latencyMs: null })).toEqual([]);
    expect(formatLatency(840)).toBe("840 ms");
  });
});

describe("cuándo", () => {
  const NOW = new Date("2026-10-03T18:00:00Z"); // 14:00 en Caracas
  it("hoy, ayer y fecha, en la zona del negocio", () => {
    expect(whenLabel("2026-10-03T17:05:00Z", "America/Caracas", NOW)).toBe("hoy 13:05");
    expect(whenLabel("2026-10-03T01:30:00Z", "America/Caracas", NOW)).toBe("ayer 21:30"); // 21:30 del 2 de octubre en Caracas
    expect(whenLabel("2026-10-02T01:30:00Z", "America/Caracas", NOW)).toBe("1 oct 21:30");
    expect(whenLabel("2026-09-20T13:10:00Z", "America/Caracas", NOW)).toMatch(/^20 sept? 09:10$/);
  });
  it("el jueves 21:10 de Caracas todavía es jueves", () => {
    expect(whenLabel("2026-09-25T01:10:00Z", "America/Caracas", new Date("2026-09-25T02:00:00Z"))).toBe("hoy 21:10");
  });
});

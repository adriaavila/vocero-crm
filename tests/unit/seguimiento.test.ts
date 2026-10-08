import { describe, expect, it } from "vitest";
import {
  horaDecente,
  normalizarSeguimiento,
  seguimientoLabel,
  tocaSeguimiento,
  transcriptoSeguimiento,
} from "@/lib/seguimiento";
import { seguimientoSchema } from "@/server/agencia/seguimiento-prompt";
import { aiMockCompletion } from "@/server/dev/ai-mock";
import { seguimientoInstruccion } from "@/server/agencia/seguimiento-prompt";

const H = 3_600_000;
const now = new Date("2026-10-08T15:00:00Z");
const ago = (h: number) => new Date(now.getTime() - h * H);

describe("seguimiento — reglas puras", () => {
  it("0, vacío o fuera de rango es apagado", () => {
    expect(normalizarSeguimiento(0)).toBeNull();
    expect(normalizarSeguimiento(null)).toBeNull();
    expect(normalizarSeguimiento(24)).toBeNull();
    expect(normalizarSeguimiento(-1)).toBeNull();
    expect(normalizarSeguimiento(4)).toBe(4);
    expect(normalizarSeguimiento("8")).toBe(8);
  });

  it("los rótulos dicen qué hace", () => {
    expect(seguimientoLabel(0)).toBe("No le escribas");
    expect(seguimientoLabel(4)).toContain("recomendado");
    expect(seguimientoLabel(8)).toBe("Le escribe 8 horas después");
  });

  it("toca cuando pasó el silencio y la ventana sigue abierta con margen", () => {
    expect(tocaSeguimiento({ hours: 4, lastInboundAt: ago(5), lastMessageAt: ago(4.5), now })).toBe(true);
    expect(tocaSeguimiento({ hours: 4, lastInboundAt: ago(3), lastMessageAt: ago(2.9), now })).toBe(false);
    // A 20 min de cerrar la ventana ya no: Meta lo rechazaría.
    expect(tocaSeguimiento({ hours: 20, lastInboundAt: ago(23.7), lastMessageAt: ago(23.6), now })).toBe(false);
    expect(tocaSeguimiento({ hours: 20, lastInboundAt: ago(22), lastMessageAt: ago(21.9), now })).toBe(true);
  });

  it("nunca de noche en la zona del negocio", () => {
    // 15:00 UTC = 11:00 en Caracas, 4:00 en Auckland (horario de verano).
    expect(horaDecente(now, "America/Caracas")).toBe(true);
    expect(horaDecente(now, "Pacific/Auckland")).toBe(false);
  });

  it("el transcripto usa solo lo que tiene texto, en orden", () => {
    const t = transcriptoSeguimiento([
      { direction: "in", text: "hola, precio de la limpieza?" },
      { direction: "out", text: null },
      { direction: "out", text: "Cuesta $40. ¿Te aparto un horario?" },
    ]);
    expect(t).toBe("Cliente: hola, precio de la limpieza?\nTú: Cuesta $40. ¿Te aparto un horario?");
  });

  it("una salida rara del modelo se vuelve «no escribas»", () => {
    expect(seguimientoSchema.parse({ send: "sí", text: 3 })).toEqual({ send: false, text: "" });
    expect(seguimientoSchema.parse({ send: true, text: "  ¿Pudiste verlo?  " })).toEqual({ send: true, text: "¿Pudiste verlo?" });
  });

  it("el mock retoma lo abierto y respeta la despedida", () => {
    const system = seguimientoInstruccion(4);
    const abierto = JSON.parse(
      aiMockCompletion([
        { role: "system", content: system },
        { role: "user", content: "CONVERSACIÓN HASTA AHORA:\nCliente: precio?\nTú: $40" },
      ])
    );
    expect(abierto.send).toBe(true);
    const cerrado = JSON.parse(
      aiMockCompletion([
        { role: "system", content: system },
        { role: "user", content: "CONVERSACIÓN HASTA AHORA:\nCliente: ok gracias\nTú: ¡Con gusto!" },
      ])
    );
    expect(cerrado.send).toBe(false);
  });
});

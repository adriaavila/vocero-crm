import { describe, expect, it } from "vitest";
import { textoResumenDia } from "@/lib/avisos";

describe("resumen diario — texto", () => {
  it("un día sin clientes no se avisa", () => {
    expect(textoResumenDia({ clientes: 0, respuestas: 0, citas: 0, teEsperan: 0 })).toBeNull();
  });

  it("dice lo que hizo el agente y si alguien te espera", () => {
    expect(textoResumenDia({ clientes: 12, respuestas: 34, citas: 2, teEsperan: 3 })).toEqual({
      title: "Hoy te escribieron 12 clientes",
      body: "Tu agente contestó 34 mensajes y agendó 2 citas. 3 conversaciones te esperan.",
    });
    expect(textoResumenDia({ clientes: 1, respuestas: 1, citas: 0, teEsperan: 0 })).toEqual({
      title: "Hoy te escribió 1 cliente",
      body: "Tu agente contestó 1 mensaje. Nadie te espera.",
    });
    expect(textoResumenDia({ clientes: 2, respuestas: 0, citas: 0, teEsperan: 1 })?.body).toBe(
      "Tu agente no contestó ninguno. 1 conversación te espera."
    );
  });
});

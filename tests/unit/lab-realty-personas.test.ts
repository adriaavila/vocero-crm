import { describe, expect, it, vi } from "vitest";

const { chatJson } = vi.hoisted(() => ({ chatJson: vi.fn() }));
vi.mock("@/lib/ai", () => ({ chatJson }));

import { buildRealtyPersonas, PERSONA_LABELS, PERSONAS } from "@/server/lab/personas";
import { maxClientTurns, nextClientLine } from "@/server/lab/client-sim";
import { buildJudgePrompt } from "@/server/ai/prompts";

const santorini = {
  title: "Santorini · Vivienda 4",
  operation: "venta",
  kind: "casa",
  price: "132000.00",
  currency: "USD",
  neighborhood: "Santorini",
  city: "Tarija",
  bedrooms: 3,
  acceptedPayments: ["contado", "credito_bancario"],
};

describe("Laboratorio inmobiliario — personas con el catálogo real", () => {
  it("sin propiedades no arma personas (quien llama avisa antes de correr)", () => {
    expect(buildRealtyPersonas([])).toEqual([]);
  });

  it("usa la propiedad, la zona y el precio REALES, y nada de la tienda genérica", () => {
    const personas = buildRealtyPersonas([santorini]);
    expect(personas).toHaveLength(7);
    const all = JSON.stringify(personas);
    expect(all).not.toMatch(/taladro|garant[ií]as|qu[eé] venden|devoluciones/i);

    const busca = personas.find((p) => p.key === "busca_lo_que_tienes")!;
    expect(busca.script[0]).toBe("Hola, buenas. Busco casa en venta por Santorini");
    expect(busca.script[1]).toContain("$146.000 USD");
    expect(busca.expectations.join(" ")).toContain("Santorini · Vivienda 4");
    expect(busca.expectations.join(" ")).toContain("$132.000 USD");

    const pago = personas.find((p) => p.key === "pregunta_forma_de_pago")!;
    expect(pago.expectations[0]).toContain("Contado, Crédito bancario");
  });

  it("lo que no hay es un tipo que el catálogo no tiene y más dormitorios que el máximo", () => {
    const noHay = buildRealtyPersonas([santorini]).find(
      (p) => p.key === "pide_lo_que_no_tienes"
    )!;
    expect(noHay.script[0]).toContain("departamento de 6 dormitorios");
  });

  it("cada persona tiene etiqueta visible y criterio de aprobado", () => {
    for (const p of [...PERSONAS, ...buildRealtyPersonas([santorini])]) {
      expect(PERSONA_LABELS[p.key]).toBe(p.label);
      expect(p.expectations.length).toBeGreaterThan(0);
    }
  });
});

describe("Laboratorio — cliente simulado que contesta", () => {
  const [busca] = buildRealtyPersonas([santorini]);

  it("el primer mensaje es siempre la línea 1 del guion, sin llamar a la IA", async () => {
    chatJson.mockClear();
    const line = await nextClientLine({ persona: busca!, turn: 0, transcript: [] });
    expect(line?.text).toBe(busca!.script[0]);
    expect(chatJson).not.toHaveBeenCalled();
  });

  it("contesta lo que el agente preguntó cuando la IA responde bien", async () => {
    chatJson.mockResolvedValueOnce({
      ok: true,
      data: { mensaje: "Somos 4, así que 3 dormitorios", terminado: false },
    });
    const line = await nextClientLine({
      persona: busca!,
      turn: 1,
      transcript: [
        { role: "cliente", text: busca!.script[0]! },
        { role: "agente", text: "¡Hola! ¿Para cuántas personas?" },
      ],
    });
    expect(line).toEqual({ text: "Somos 4, así que 3 dormitorios", done: false });
  });

  it("si la IA falla o responde otra cosa, sale la línea del guion", async () => {
    chatJson.mockResolvedValueOnce({ ok: false, error: "timeout", detail: "" });
    expect((await nextClientLine({ persona: busca!, turn: 2, transcript: [] }))?.text).toBe(
      busca!.script[2]
    );
    chatJson.mockResolvedValueOnce({ ok: true, data: { action: "reply", text: "x" } });
    expect((await nextClientLine({ persona: busca!, turn: 1, transcript: [] }))?.text).toBe(
      busca!.script[1]
    );
  });

  it("no pasa del guion más un turno", async () => {
    expect(maxClientTurns(busca!)).toBe(busca!.script.length + 1);
    expect(
      await nextClientLine({ persona: busca!, turn: maxClientTurns(busca!), transcript: [] })
    ).toBeNull();
  });
});

describe("Juez — criterios de aprobado", () => {
  it("lleva los criterios de la persona y no castiga el 'no lo sé'", () => {
    const { system, user } = buildJudgePrompt({
      persona: "busca_lo_que_tienes",
      transcript: [{ role: "cliente", text: "hola" }],
      kbText: "",
      behaviorText: "",
      expectations: ["Dice el precio exacto"],
    });
    expect(user).toContain("CRITERIOS DE APROBADO DE ESTA PERSONA:\n- Dice el precio exacto");
    expect(system).toContain("es lo CORRECTO: no es hallazgo");
  });
});

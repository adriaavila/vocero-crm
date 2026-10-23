import { beforeEach, describe, expect, it, vi } from "vitest";

const chatJson = vi.fn();

vi.mock("@/lib/ai", () => ({
  chatJson: (...args: unknown[]) => chatJson(...args),
}));

import { buildJudgePrompt } from "@/server/ai/prompts";
import { judgeCase } from "@/server/lab/judge";

/**
 * El juez solo veía el texto: no sabía que el agente había pasado la
 * conversación a una persona y lo marcaba «debió escalar».
 */

const transcript = [
  { role: "cliente" as const, text: "Prefiero tratar esto con una persona." },
  { role: "agente" as const, text: "Te paso con Ana, del equipo." },
];

describe("Juez — el traspaso es un hecho del transcript", () => {
  it("con traspaso, el transcript termina con la línea SISTEMA", () => {
    const { system, user } = buildJudgePrompt({
      persona: "pide_humano",
      transcript,
      kbText: "",
      behaviorText: "",
      handedOff: true,
    });
    expect(user).toContain(
      "AGENTE: Te paso con Ana, del equipo.\nSISTEMA: el agente pasó la conversación a una persona del equipo (traspaso)."
    );
    expect(system).toContain("si dice que hubo traspaso, el agente SÍ escaló");
    expect(system).toContain("Antes de marcar alucinacion, busca el dato en el CONOCIMIENTO");
  });

  it("sin traspaso, no hay línea SISTEMA", () => {
    const { user } = buildJudgePrompt({ persona: "x", transcript, kbText: "", behaviorText: "" });
    expect(user).not.toContain("SISTEMA:");
  });

  describe("judgeCase", () => {
    beforeEach(() => chatJson.mockReset());

    it("descarta el «debió escalar» sobre el mensaje con el que escaló", async () => {
      chatJson.mockResolvedValue({
        ok: true,
        raw: "{}",
        data: {
          veredicto: "rojo",
          hallazgos: [{ tipo: "debio_escalar", evidencia: "Te paso con Ana, del equipo." }],
        },
      });
      const outcome = await judgeCase({
        personaKey: "pide_humano",
        transcript,
        kbText: "",
        behaviorText: "",
        handedOff: true,
      });
      expect(outcome).toEqual({ status: "done", verdict: { veredicto: "verde", hallazgos: [] } });
      expect(String(chatJson.mock.calls[0]![1][1].content)).toContain("SISTEMA:");
    });

    it("sin traspaso, el veredicto del juez queda igual", async () => {
      const data = {
        veredicto: "rojo",
        hallazgos: [{ tipo: "debio_escalar", evidencia: "Te paso con Ana, del equipo." }],
      };
      chatJson.mockResolvedValue({ ok: true, raw: "{}", data });
      const outcome = await judgeCase({ personaKey: "pide_humano", transcript, kbText: "", behaviorText: "" });
      expect(outcome).toEqual({ status: "done", verdict: data });
    });
  });
});

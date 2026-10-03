import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Data spine — la decisión del agente: lo que Nea manda en `decision` (opcional,
 * validado con Zod), el registro de la fila y que NADA de esto pueda tumbar un
 * turno. La fila contra Postgres: data-spine-realdb.test.ts.
 */

const state = vi.hoisted(() => ({
  inserts: [] as Record<string, unknown>[],
  selectRows: [] as { id: string }[],
  failInsert: false,
  failSelect: false,
}));

vi.mock("@/lib/db", () => {
  const selectChain = () => {
    const c: Record<string, unknown> = {};
    for (const m of ["from", "where"]) c[m] = () => c;
    (c as { then: unknown }).then = (
      resolve: (v: unknown) => unknown,
      reject: (e: unknown) => unknown
    ) => (state.failSelect ? reject(new TypeError("select roto")) : resolve(state.selectRows));
    return c;
  };
  return {
    getDb: () => ({
      select: selectChain,
      insert: () => ({
        values: (v: Record<string, unknown>) => {
          if (state.failInsert) return Promise.reject(new Error("insert roto"));
          state.inserts.push(v);
          return Promise.resolve();
        },
      }),
    }),
    schema: new Proxy(
      {},
      {
        get: (_t, tableName) =>
          new Proxy({}, { get: (_t2, col) => `${String(tableName)}.${String(col)}` }),
      }
    ),
  };
});

import { neaMessageId } from "@/lib/db/ids";
import {
  inboundSinceLastReply,
  MAX_STEP_SUMMARY,
  MAX_STEPS,
  parseNeaDecision,
  promptVersionOf,
  recordAgentDecision,
  recordNeaDecision,
} from "@/server/agencia/decisions";

beforeEach(() => {
  state.inserts.length = 0;
  state.selectRows = [];
  state.failInsert = false;
  state.failSelect = false;
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("parseNeaDecision", () => {
  it("ausente o inservible → null (el turno sigue igual)", () => {
    expect(parseNeaDecision(undefined)).toBeNull();
    expect(parseNeaDecision(null)).toBeNull();
    expect(parseNeaDecision("texto")).toBeNull();
    expect(parseNeaDecision(42)).toBeNull();
  });

  it("acepta la forma completa", () => {
    expect(
      parseNeaDecision({
        model: "gpt-4o-mini",
        promptVersion: "v12",
        steps: [{ tool: "buscar_kb", summary: "3 resultados", ok: true }],
        latencyMs: 1830,
        tokens: { input: 1200, output: 90 },
      })
    ).toEqual({
      model: "gpt-4o-mini",
      promptVersion: "v12",
      steps: [{ tool: "buscar_kb", summary: "3 resultados", ok: true }],
      latencyMs: 1830,
      tokens: { input: 1200, output: 90 },
    });
  });

  it("recorta: máximo 20 pasos y 200 caracteres por summary", () => {
    const steps = Array.from({ length: 35 }, (_, i) => ({
      tool: `t${i}`,
      summary: "x".repeat(500),
      ok: true,
    }));
    const parsed = parseNeaDecision({ steps })!;
    expect(parsed.steps).toHaveLength(MAX_STEPS);
    expect(parsed.steps![0]!.summary).toHaveLength(MAX_STEP_SUMMARY);
  });

  it("cada campo falla por su cuenta: uno malo no descarta el resto", () => {
    const parsed = parseNeaDecision({
      model: "m",
      latencyMs: -5,
      tokens: { input: "mucho", output: 3 },
      promptVersion: 7,
      steps: [{ tool: "ok", summary: "bien", ok: true }, { tool: "", ok: true }, "raro", { tool: "sin_ok" }],
    });
    expect(parsed).toEqual({ model: "m", steps: [{ tool: "ok", summary: "bien", ok: true }] });
  });

  it("un paso sin summary lo lleva vacío", () => {
    expect(parseNeaDecision({ steps: [{ tool: "x", ok: false }] })!.steps).toEqual([
      { tool: "x", summary: "", ok: false },
    ]);
  });
});

describe("ayudas puras", () => {
  it("promptVersionOf: 12 hex del sha256 del prompt, estable", () => {
    const v = promptVersionOf("Eres un agente.");
    expect(v).toMatch(/^[0-9a-f]{12}$/);
    expect(promptVersionOf("Eres un agente.")).toBe(v);
    expect(promptVersionOf("Eres un agente!")).not.toBe(v);
  });

  it("inboundSinceLastReply: los entrantes posteriores al último saliente", () => {
    expect(
      inboundSinceLastReply([
        { id: "a", direction: "in" },
        { id: "b", direction: "out" },
        { id: "c", direction: "in" },
        { id: "d", direction: "in" },
      ])
    ).toEqual(["c", "d"]);
    expect(inboundSinceLastReply([{ id: "a", direction: "out" }])).toEqual([]);
    expect(inboundSinceLastReply([{ id: "a", direction: "in" }])).toEqual(["a"]);
  });
});

describe("recordNeaDecision", () => {
  const base = {
    organizationId: "org_1",
    conversationId: "cv_1",
    isTest: false,
    dispatchId: "aj_1",
    triggerMessageIds: ["msg_in_1"],
  };

  it("Nea con `decision`: la fila lleva modelo, prompt, pasos, latencia y tokens", async () => {
    state.selectRows = [{ id: neaMessageId("org_1", "cv_1", "aj_1", 0) }];

    const id = await recordNeaDecision({
      ...base,
      body: {
        ok: true,
        action: "replied",
        decision: {
          model: "gpt-4o-mini",
          promptVersion: "p7",
          steps: [{ tool: "consultar_agenda", summary: "2 huecos", ok: true }],
          latencyMs: 2100,
          tokens: { input: 900, output: 60 },
        },
      },
    });

    expect(id).toMatch(/^dec_/);
    expect(state.inserts).toHaveLength(1);
    expect(state.inserts[0]).toMatchObject({
      id,
      organizationId: "org_1",
      conversationId: "cv_1",
      brain: "nea",
      dispatchId: "aj_1",
      action: "replied",
      handoffReason: null,
      model: "gpt-4o-mini",
      promptVersion: "p7",
      latencyMs: 2100,
      inputTokens: 900,
      outputTokens: 60,
      steps: [{ tool: "consultar_agenda", summary: "2 huecos", ok: true }],
      triggerMessageIds: ["msg_in_1"],
      replyMessageIds: [neaMessageId("org_1", "cv_1", "aj_1", 0)],
    });
  });

  it("Nea SIN `decision` (el Nea de hoy): igual se registra la acción, con lo demás vacío", async () => {
    const id = await recordNeaDecision({ ...base, body: { ok: true, action: "silent" } });

    expect(id).toMatch(/^dec_/);
    expect(state.inserts[0]).toMatchObject({
      brain: "nea",
      action: "silent",
      model: null,
      promptVersion: null,
      latencyMs: null,
      inputTokens: null,
      outputTokens: null,
      steps: [],
      replyMessageIds: [],
    });
  });

  it("un `decision` basura no afecta al turno ni a la fila", async () => {
    const id = await recordNeaDecision({
      ...base,
      body: { ok: true, action: "noop", decision: { steps: "no", tokens: 3, latencyMs: "rápido" } },
    });
    expect(id).toMatch(/^dec_/);
    expect(state.inserts[0]).toMatchObject({ action: "noop", steps: [], model: null });
  });

  it("handoff de Nea: el motivo se normaliza igual que en la conversación (uno inventado cae a 'modelo')", async () => {
    await recordNeaDecision({
      ...base,
      body: { ok: true, action: "replied", handoff: { reason: "hostilidad", applied: true } },
    });
    await recordNeaDecision({
      ...base,
      body: { ok: true, action: "silent", handoff: { reason: "porque se enojó", applied: false } },
    });
    expect(state.inserts.map((i) => i.handoffReason)).toEqual(["hostilidad", "modelo"]);
  });

  it("las conversaciones del Laboratorio no se registran", async () => {
    const id = await recordNeaDecision({ ...base, isTest: true, body: { ok: true, action: "replied" } });
    expect(id).toBeNull();
    expect(state.inserts).toHaveLength(0);
  });

  it("si falla buscar los ids de la respuesta, la fila se registra igual (sin enlaces)", async () => {
    state.failSelect = true;
    const id = await recordNeaDecision({ ...base, body: { ok: true, action: "replied" } });
    expect(id).toMatch(/^dec_/);
    expect(state.inserts[0]).toMatchObject({ replyMessageIds: [] });
  });

  it("si falla el INSERT no lanza: devuelve null", async () => {
    state.failInsert = true;
    await expect(
      recordNeaDecision({ ...base, body: { ok: true, action: "replied" } })
    ).resolves.toBeNull();
  });
});

describe("recordAgentDecision", () => {
  it("recorta lo que no debe crecer sin límite", async () => {
    await recordAgentDecision({
      organizationId: "org_1",
      conversationId: "cv_1",
      isTest: false,
      brain: "rei",
      action: "reply",
      steps: Array.from({ length: 30 }, () => ({ tool: "t", summary: "", ok: true })),
      triggerMessageIds: Array.from({ length: 80 }, (_, i) => `m${i}`),
      replyMessageIds: Array.from({ length: 40 }, (_, i) => `r${i}`),
      model: "m".repeat(300),
    });
    const row = state.inserts[0]!;
    expect((row.steps as unknown[]).length).toBe(MAX_STEPS);
    expect((row.triggerMessageIds as unknown[]).length).toBe(50);
    expect((row.replyMessageIds as unknown[]).length).toBe(20);
    expect((row.model as string).length).toBe(100);
  });
});

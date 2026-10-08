import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Data spine — Rei (el cerebro en proceso) deja una fila `agent_decision` por
 * turno real: la acción ejecutada, el motivo del handoff, el modelo que
 * contestó, la versión del prompt (12 hex del sha256 del prompt compilado), los
 * tokens y los mensajes que contestó / envió. BD y proveedor mockeados; la fila
 * en Postgres: data-spine-realdb.test.ts.
 */

const state = vi.hoisted(() => ({
  selectQueue: [] as unknown[][],
  inserts: [] as { values: Record<string, unknown> }[],
  updates: [] as Record<string, unknown>[],
  chatJson: vi.fn(),
  sendText: vi.fn(),
  failInsert: false,
  memoria: null as string | null,
}));

vi.mock("@/lib/db", () => {
  const thenable = (rows: unknown[]) => {
    const c: Record<string, unknown> = {};
    for (const m of ["from", "where", "orderBy", "leftJoin", "limit"]) c[m] = () => c;
    (c as { then: unknown }).then = (resolve: (v: unknown) => unknown) => resolve(rows);
    return c;
  };
  return {
    getDb: () => ({
      select: () => thenable(state.selectQueue.shift() ?? []),
      insert: () => ({
        values: (values: Record<string, unknown>) => {
          state.inserts.push({ values });
          // `persistTestOutbound` y `recordAgentDecision` encadenan onConflictDoNothing().returning().
          return Object.assign(Promise.resolve(), {
            onConflictDoNothing: () => ({
              returning: () => {
                // Un insert que rechaza (BD caída, veneno…) no debe asomar al turno.
                if (state.failInsert && "brain" in values) {
                  state.inserts.pop();
                  return Promise.reject(new Error("insert roto"));
                }
                return Promise.resolve([{ id: (values.id as string) ?? "msg_test_1" }]);
              },
            }),
          });
        },
      }),
      update: () => ({
        set: (values: Record<string, unknown>) => {
          state.updates.push(values);
          return { where: () => ({ returning: () => Promise.resolve([{ id: "cv_1" }]) }) };
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
vi.mock("@/lib/ai", () => ({ chatJson: state.chatJson }));
vi.mock("@/server/ai/credentials", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/ai/credentials")>();
  return {
    ...actual,
    getAiRuntimeConfig: async () => ({ providers: { openai: { token: "t", model: "m" } } }),
    hasConfiguredAiProvider: () => true,
  };
});
vi.mock("@/server/agencia/entitlements", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/agencia/entitlements")>();
  return { ...actual, hasSaaSPlan: async () => false };
});
vi.mock("@/server/agenda/settings", () => ({ getSettings: async () => ({ timezone: "America/Caracas" }) }));
vi.mock("@/server/agenda/flag", () => ({ agendaEnabled: () => false }));
vi.mock("@/server/inbox/send", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/inbox/send")>();
  return { ...actual, sendText: state.sendText };
});
vi.mock("@/server/events/bus", () => ({ publish: vi.fn() }));
vi.mock("@/server/agencia/memoria-cliente", () => ({ memoriaParaPrompt: async () => state.memoria }));

import { runAgentTurn } from "@/server/ai/pipeline";
import { promptVersionOf } from "@/server/agencia/decisions";

const NOW = new Date();
const CONVERSATION = {
  id: "cv_1",
  organizationId: "org_1",
  contactId: "ct_1",
  isTest: false,
  aiEnabled: true,
  handoffAt: null,
  lastInboundAt: NOW,
};
const PROFILE = {
  enabled: true,
  aiProvider: "openai",
  businessName: "Dental Sonrisa",
  tone: "amable",
  goals: "agendar citas",
  language: "es",
};
// Se piden DESC y el pipeline las invierte: la más nueva primero.
const HISTORY_DESC = [
  { id: "msg_in_2", direction: "in", text: "y cuánto cuesta?", createdAt: NOW },
  { id: "msg_in_1", direction: "in", text: "hola", createdAt: NOW },
  { id: "msg_out_0", direction: "out", text: "bienvenido", createdAt: NOW },
  { id: "msg_in_0", direction: "in", text: "buenas", createdAt: NOW },
];

function queueTurn(history: unknown[] = HISTORY_DESC, conversation: unknown = CONVERSATION) {
  state.selectQueue.push([conversation], [PROFILE], history, []);
}

beforeEach(() => {
  state.selectQueue.length = 0;
  state.inserts.length = 0;
  state.updates.length = 0;
  state.failInsert = false;
  state.memoria = null;
  state.chatJson.mockReset();
  state.sendText.mockReset().mockResolvedValue({ messageId: "msg_reply_1" });
  vi.stubEnv("NEA_DISPATCH_URL", "");
  vi.stubEnv("ALLOK_SAAS_MODE", "");
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("Rei registra su decisión", () => {
  it("reply: acción, modelo del proveedor que contestó, tokens, versión del prompt y mensajes enlazados", async () => {
    queueTurn();
    state.chatJson.mockResolvedValue({
      ok: true,
      data: { action: "reply", text: "Una limpieza cuesta 40 USD." },
      raw: "{}",
      provider: "openai",
      model: "gpt-4o-mini",
      usage: { input: 812, output: 44 },
    });

    await runAgentTurn("cv_1");

    expect(state.inserts).toHaveLength(1);
    const row = state.inserts[0]!.values;
    expect(row).toMatchObject({
      organizationId: "org_1",
      conversationId: "cv_1",
      brain: "rei",
      dispatchId: null,
      action: "reply",
      handoffReason: null,
      model: "gpt-4o-mini",
      inputTokens: 812,
      outputTokens: 44,
      triggerMessageIds: ["msg_in_1", "msg_in_2"], // los posteriores al último saliente
      replyMessageIds: ["msg_reply_1"],
    });
    expect(row.latencyMs).toEqual(expect.any(Number));

    // prompt_version = 12 hex del sha256 del prompt de sistema QUE SE ENVIÓ.
    const sentMessages = state.chatJson.mock.calls[0]![1] as { role: string; content: string }[];
    const systemPrompt = sentMessages[0]!.content;
    expect(row.promptVersion).toMatch(/^[0-9a-f]{12}$/);
    expect(row.promptVersion).toBe(promptVersionOf(systemPrompt));
  });

  it("la memoria del cliente va en un sistema aparte: la versión del prompt no cambia por cliente", async () => {
    const turno = async () => {
      queueTurn();
      state.chatJson.mockResolvedValue({ ok: true, data: { action: "none" }, raw: "{}", model: "m" });
      await runAgentTurn("cv_1");
      return state.chatJson.mock.calls.at(-1)![1] as { role: string; content: string }[];
    };
    const sinMemoria = await turno();
    state.memoria = "LO QUE YA SABES DE ESTE CLIENTE:\n- Se llama Marta.";
    const conMemoria = await turno();

    expect(sinMemoria.filter((m) => m.role === "system")).toHaveLength(1);
    expect(conMemoria[1]).toEqual({ role: "system", content: state.memoria });
    expect(conMemoria[0]!.content).toBe(sinMemoria[0]!.content);
    expect(state.inserts.at(-1)!.values.promptVersion).toBe(state.inserts[0]!.values.promptVersion);
  });

  it("handoff por el modelo: acción handoff, motivo 'modelo', y la despedida enlazada", async () => {
    queueTurn();
    state.chatJson.mockResolvedValue({
      ok: true,
      data: { action: "handoff", farewell: "Te paso con una persona." },
      raw: "{}",
      model: "gpt-4o-mini",
    });

    await runAgentTurn("cv_1");

    expect(state.inserts[0]!.values).toMatchObject({
      action: "handoff",
      handoffReason: "modelo",
      replyMessageIds: ["msg_reply_1"],
      inputTokens: null, // el proveedor no reportó uso
      outputTokens: null,
    });
  });

  it("none: se registra sin respuesta", async () => {
    queueTurn();
    state.chatJson.mockResolvedValue({ ok: true, data: { action: "none" }, raw: "{}", model: "m" });

    await runAgentTurn("cv_1");

    expect(state.sendText).not.toHaveBeenCalled();
    expect(state.inserts[0]!.values).toMatchObject({ action: "none", replyMessageIds: [] });
  });

  it("update_lead: queda el paso, sin el contenido de la nota", async () => {
    queueTurn();
    state.chatJson.mockResolvedValue({
      ok: true,
      data: { action: "update_lead", note: "quiere blanqueamiento, vive en Chacao", reply: "Anotado." },
      raw: "{}",
      model: "m",
    });
    state.selectQueue.push([{ id: "ct_1", notes: null }]); // appendLeadNote

    await runAgentTurn("cv_1");

    const row = state.inserts[0]!.values;
    expect(row.steps).toEqual([{ tool: "update_lead", summary: "", ok: true }]);
    expect(JSON.stringify(row)).not.toContain("Chacao");
  });

  it("el patrón de respaldo (antes del LLM): handoff 'cliente', sin modelo ni llamada al proveedor", async () => {
    queueTurn([{ id: "msg_in_9", direction: "in", text: "quiero hablar con una persona", createdAt: NOW }]);

    await runAgentTurn("cv_1");

    expect(state.chatJson).not.toHaveBeenCalled();
    expect(state.inserts[0]!.values).toMatchObject({
      brain: "rei",
      action: "handoff",
      handoffReason: "cliente",
      model: null,
      promptVersion: null,
      triggerMessageIds: ["msg_in_9"],
    });
  });

  it("ventana cerrada: handoff 'ventana'", async () => {
    queueTurn(HISTORY_DESC, { ...CONVERSATION, lastInboundAt: new Date(Date.now() - 30 * 3600_000) });

    await runAgentTurn("cv_1");

    expect(state.inserts[0]!.values).toMatchObject({ action: "handoff", handoffReason: "ventana" });
  });

  it("el proveedor falla: handoff 'error', con latencia y versión del prompt pero sin modelo", async () => {
    queueTurn();
    state.chatJson.mockResolvedValue({ ok: false, error: "provider_error", detail: "500" });

    await runAgentTurn("cv_1");

    const row = state.inserts[0]!.values;
    expect(row).toMatchObject({ action: "handoff", handoffReason: "error", model: null });
    expect(row.promptVersion).toMatch(/^[0-9a-f]{12}$/);
  });

  it("sin proveedor configurado en el turno (not_configured) no hay turno: ninguna fila", async () => {
    queueTurn();
    state.chatJson.mockResolvedValue({ ok: false, error: "not_configured", detail: "" });

    await runAgentTurn("cv_1");

    expect(state.inserts).toHaveLength(0);
  });

  it("conversación del Laboratorio: no se registra", async () => {
    queueTurn(HISTORY_DESC, { ...CONVERSATION, isTest: true });
    state.chatJson.mockResolvedValue({
      ok: true,
      data: { action: "reply", text: "hola" },
      raw: "{}",
      model: "m",
    });

    await runAgentTurn("cv_1");

    // El mensaje de prueba sí se persiste (sandbox); la decisión no.
    expect(state.inserts.filter((i) => "brain" in i.values)).toHaveLength(0);
    expect(state.inserts.filter((i) => i.values.direction === "out")).toHaveLength(1);
  });

  it("si registrar la decisión revienta, el turno igual termina bien", async () => {
    queueTurn();
    state.chatJson.mockResolvedValue({
      ok: true,
      data: { action: "reply", text: "Hola" },
      raw: "{}",
      model: "m",
    });
    state.failInsert = true; // un insert que rechaza no debe asomar al turno
    await expect(runAgentTurn("cv_1")).resolves.toEqual({ leftover: false });
    expect(state.sendText).toHaveBeenCalledTimes(1);
  });
});

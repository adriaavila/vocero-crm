import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Fork — una respuesta con una palabra que el dueño prohibió no sale: el
 * modelo la reescribe una vez y, si insiste, la conversación pasa a una
 * persona. BD y proveedor mockeados (mismo arnés que data-spine-rei-decision).
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
  instructions: "- Nunca usas las palabras renta, rendimiento ni plusvalía.",
  escalationRules: null,
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

const ok = (data: unknown) => ({ ok: true, data, raw: "{}", model: "m" });

describe("palabras prohibidas al responder", () => {
  it("la respuesta con «rendimiento» se reescribe y sale la limpia", async () => {
    queueTurn();
    state.chatJson
      .mockResolvedValueOnce(ok({ action: "reply", text: "El rendimiento te lo explica el equipo." }))
      .mockResolvedValueOnce(ok({ action: "reply", text: "Eso te lo explica el equipo con tus números." }));

    await runAgentTurn("cv_1");

    expect(state.chatJson).toHaveBeenCalledTimes(2);
    const segunda = state.chatJson.mock.calls[1]![1] as { role: string; content: string }[];
    expect(segunda.at(-1)).toMatchObject({ role: "system", content: expect.stringContaining("«rendimiento»") });
    const enviados = state.sendText.mock.calls.map((c) => JSON.stringify(c));
    expect(enviados.join(" ")).toContain("Eso te lo explica el equipo con tus números.");
    expect(enviados.join(" ")).not.toContain("rendimiento");
  });

  it("si la reescrita vuelve a usarla, pasa a una persona sin mandarla", async () => {
    queueTurn();
    state.chatJson.mockResolvedValue(ok({ action: "reply", text: "La renta es buena." }));

    await runAgentTurn("cv_1");

    expect(state.chatJson).toHaveBeenCalledTimes(2);
    const enviados = state.sendText.mock.calls.map((c) => JSON.stringify(c)).join(" ");
    expect(enviados).not.toContain("renta");
    expect(state.inserts.at(-1)!.values).toMatchObject({ action: "handoff", handoffReason: "modelo" });
  });

  it("sin palabra prohibida, una sola llamada", async () => {
    queueTurn();
    state.chatJson.mockResolvedValue(ok({ action: "reply", text: "La casa tiene 3 dormitorios." }));
    await runAgentTurn("cv_1");
    expect(state.chatJson).toHaveBeenCalledTimes(1);
  });
});

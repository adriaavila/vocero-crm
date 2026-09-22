import { beforeEach, describe, expect, it, vi } from "vitest";

const inserted: Record<string, unknown>[] = [];
let failInsert = false;

vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  return {
    ...actual,
    getDb: () => ({
      insert: () => ({
        values: async (row: Record<string, unknown>) => {
          if (failInsert) throw new Error("db caída");
          inserted.push(row);
        },
      }),
    }),
  };
});

const { recordAiUsage } = await import("@/server/agencia/usage");

const usage = {
  provider: "openai" as const,
  model: "gpt-4o-mini",
  calls: 2,
  promptTokens: 220,
  completionTokens: 16,
};

describe("recordAiUsage", () => {
  beforeEach(() => {
    inserted.length = 0;
    failInsert = false;
  });

  it("un turno que llegó al proveedor deja su fila con los tokens", async () => {
    await recordAiUsage({
      organizationId: "org_1",
      conversationId: "cv_1",
      kind: "agent",
      ok: true,
      usage,
    });

    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      organizationId: "org_1",
      conversationId: "cv_1",
      kind: "agent",
      model: "gpt-4o-mini",
      calls: 2,
      promptTokens: 220,
      completionTokens: 16,
      ok: true,
    });
    expect(String(inserted[0]!.id)).toMatch(/^use_/);
  });

  it("sin llamadas al proveedor no escribe nada", async () => {
    await recordAiUsage({
      organizationId: "org_1",
      conversationId: "cv_1",
      kind: "agent",
      ok: false,
      usage: { ...usage, calls: 0, promptTokens: 0, completionTokens: 0 },
    });

    expect(inserted).toHaveLength(0);
  });

  it("un fallo de la base no propaga: el turno sigue", async () => {
    failInsert = true;
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      recordAiUsage({ organizationId: "org_1", conversationId: null, kind: "agent", ok: true, usage })
    ).resolves.toBeUndefined();
  });
});

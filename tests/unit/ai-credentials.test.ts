import { beforeAll, describe, expect, it, vi } from "vitest";

const insertedRows: Record<string, unknown>[] = [];

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        insertedRows.push(values);
        return { onConflictDoUpdate: () => Promise.resolve() };
      },
    }),
  }),
  schema: {
    aiCredentials: {
      organizationId: "organization_id",
      provider: "provider",
    },
  },
}));

beforeAll(() => {
  process.env.APP_BASE_URL = "http://localhost:3000";
  process.env.DATABASE_URL = "postgresql://t:t@localhost:5432/t";
  process.env.BETTER_AUTH_SECRET = "secret-de-test-suficiente";
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 8).toString("base64");
  process.env.META_WEBHOOK_VERIFY_TOKEN = "verify-test";
});

describe("credenciales de IA por organización", () => {
  it("cifra la clave y solo conserva los últimos cuatro caracteres", async () => {
    const { saveAiCredential } = await import("@/server/ai/credentials");
    const apiKey = "sk-or-super-secreta-1234";
    await saveAiCredential({
      organizationId: "org_1",
      provider: "openrouter",
      apiKey,
      model: "z-ai/glm-5.3-flash",
    });

    const row = insertedRows.at(-1)!;
    expect(JSON.stringify(row)).not.toContain(apiKey);
    expect(row.keyLast4).toBe("1234");

    const { decryptSecret } = await import("@/lib/crypto");
    expect(
      decryptSecret({
        cipher: row.keyCipher as string,
        iv: row.keyIv as string,
        tag: row.keyTag as string,
      })
    ).toBe(apiKey);
  });
});

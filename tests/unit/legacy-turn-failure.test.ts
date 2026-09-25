import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `executeTurn` (debounce legado, instancia dedicada): el trato de un turno
 * que revienta depende de QUIÉN iba a contestar.
 *
 * Con Nea: mismo trato que el worker de SaaS — `applyHandoff("error")`, para
 * que un humano se entere en vez de que la conversación quede pausada en
 * silencio tras agotar los reintentos del despacho.
 *
 * Con Rei (comportamiento de `main`, SIN CAMBIOS): solo se loggea. Rei ya
 * escala con handoff("error") DESDE ADENTRO cuando el proveedor falla
 * (`runAgentTurn`); un fallo genérico (p. ej. la BD) no debe escalar solo
 * porque sí — eso es lo que introducir un handoff aquí para Rei rompía.
 */

const selectQueue: unknown[][] = [];
const updates: Record<string, unknown>[] = [];

function chain(rows: unknown[]) {
  const c: Record<string, unknown> = {};
  for (const m of ["from", "where", "orderBy", "leftJoin"]) c[m] = () => c;
  c.limit = () => Promise.resolve(rows);
  return c;
}

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => chain(selectQueue.shift() ?? []),
    update: () => ({
      set: (values: Record<string, unknown>) => {
        updates.push(values);
        return {
          where: () => ({
            returning: () => Promise.resolve([{ id: "cv_1", ...values }]),
          }),
        };
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
}));

const { dispatchToNea } = vi.hoisted(() => ({ dispatchToNea: vi.fn() }));
vi.mock("@/server/ai/nea-dispatch", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/ai/nea-dispatch")>();
  return { ...actual, dispatchToNea };
});

const { hasConfiguredAiProvider } = vi.hoisted(() => ({ hasConfiguredAiProvider: vi.fn() }));
vi.mock("@/server/ai/credentials", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/ai/credentials")>();
  return { ...actual, hasConfiguredAiProvider };
});

import { resetEnvCacheForTests } from "@/lib/env";
import { scheduleAgentTurn } from "@/server/ai/pipeline";

const CONVERSATION = {
  id: "cv_1",
  organizationId: "org_1",
  contactId: "ct_1",
  isTest: false,
  aiEnabled: true,
  handoffAt: null as Date | null,
};
const PROFILE = { enabled: true, activationEnabled: false };
const CONTACT = { waIdentity: "5215512345678", name: "Ana" };
const INBOUND_MESSAGE = {
  id: "msg_1",
  waMessageId: "wamid.1",
  direction: "in" as const,
  type: "text",
  text: "hola",
  waTimestamp: null,
  createdAt: new Date("2026-09-25T12:00:00.000Z"),
  mediaWaId: null,
};

async function waitForDebounce(): Promise<void> {
  // AGENT_COALESCE_MS=0: el timer real dispara casi al toque; una vuelta
  // corta de macrotask + un respiro para la cadena async de `executeTurn`
  // (incluido el `await` del handoff) basta sin recurrir a fake timers.
  await new Promise((resolve) => setTimeout(resolve, 20));
  await new Promise((resolve) => setTimeout(resolve, 20));
}

describe("executeTurn — trato del fallo según quién contesta (instancia dedicada)", () => {
  beforeEach(() => {
    selectQueue.length = 0;
    updates.length = 0;
    dispatchToNea.mockReset();
    hasConfiguredAiProvider.mockReset();
    vi.stubEnv("APP_BASE_URL", "http://localhost:3000");
    vi.stubEnv("DATABASE_URL", "postgresql://t:t@localhost:5432/t");
    vi.stubEnv("BETTER_AUTH_SECRET", "secret-de-test-suficiente");
    vi.stubEnv("ENCRYPTION_KEY", Buffer.alloc(32, 4).toString("base64"));
    vi.stubEnv("META_WEBHOOK_VERIFY_TOKEN", "verify-test");
    vi.stubEnv("AGENT_COALESCE_MS", "0");
    vi.stubEnv("ALLOK_SAAS_MODE", "");
    resetEnvCacheForTests();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    resetEnvCacheForTests();
  });

  it("Nea configurada + el despacho falla → handoff('error') (como el worker de SaaS)", async () => {
    vi.stubEnv("BOT_API_KEY", "clave-compartida-con-nea-larga");
    vi.stubEnv("NEA_DISPATCH_URL", "http://nea-agent:8000/dispatch");
    dispatchToNea.mockRejectedValue(new Error("Nea devolvió 500"));
    selectQueue.push(
      [CONVERSATION], // conversación (runNeaAgentTurn)
      [PROFILE], // perfil
      [CONTACT], // contacto
      [INBOUND_MESSAGE], // mensajes
      [CONVERSATION] // conversación otra vez (applyHandoffOnFailure)
    );

    await scheduleAgentTurn("cv_1");
    await waitForDebounce();

    expect(updates.some((u) => u.handoffReason === "error")).toBe(true);
  });

  it("Rei (sin Nea) + el turno revienta por un error genérico → SOLO se loggea, sin handoff (igual que main)", async () => {
    vi.stubEnv("BOT_API_KEY", "");
    vi.stubEnv("NEA_DISPATCH_URL", "");
    vi.stubEnv("OPENAI_API_KEY", "token-test");
    hasConfiguredAiProvider.mockImplementation(() => {
      throw new Error("fallo genérico (p. ej. la BD)");
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    selectQueue.push(
      [CONVERSATION], // conversación (runAgentTurn, camino Rei)
      [] // credenciales de IA (getAiRuntimeConfig)
    );

    await scheduleAgentTurn("cv_1");
    await waitForDebounce();

    expect(updates).toEqual([]); // ningún handoff/update
    expect(errorSpy).toHaveBeenCalledWith("[agente] turno falló:", expect.any(Error));
    errorSpy.mockRestore();
  });
});

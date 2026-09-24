import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A SaaS business straight out of signup must be able to answer: its inbound
 * message queues an agent_job and the schedule gate the worker applies lets
 * the reply through. Runs the real signup, ingest, trigger and gate against an
 * in-memory Postgres stand-in (rows per table; `where` is ignored because the
 * test only ever holds one business).
 */

const tables = new Map<unknown, Record<string, unknown>[]>();
function rowsOf(table: unknown): Record<string, unknown>[] {
  if (!tables.has(table)) tables.set(table, []);
  return tables.get(table)!;
}

/** Drizzle-style builder: every step chains; awaiting it yields the rows. */
function query(rows: () => unknown[]) {
  const chain: Record<string, unknown> = {
    then: (resolve: (value: unknown[]) => unknown, reject: (error: unknown) => unknown) =>
      Promise.resolve().then(rows).then(resolve, reject),
  };
  for (const step of ["where", "limit", "orderBy", "innerJoin", "returning", "onConflictDoNothing"]) {
    chain[step] = () => chain;
  }
  return chain;
}

const db = {
  execute: async () => [],
  transaction: async (run: (tx: unknown) => Promise<unknown>) => run(db),
  select: () => ({ from: (table: unknown) => query(() => rowsOf(table)) }),
  insert: (table: unknown) => ({
    values: (value: Record<string, unknown> | Record<string, unknown>[]) => {
      const added = [value].flat();
      rowsOf(table).push(...added);
      return query(() => added);
    },
  }),
  update: (table: unknown) => ({
    set: (patch: Record<string, unknown>) =>
      query(() => rowsOf(table).map((row) => Object.assign(row, patch))),
  }),
};

vi.mock("@/lib/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db")>()),
  getDb: () => db,
}));
// Contact resolution and lead bookkeeping are not what this test is about.
vi.mock("@/server/inbox/identity", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/inbox/identity")>()),
  getOrCreateContactByIdentity: async () => ({
    contact: { id: "contact_ana", channel: "whatsapp" },
    isNew: true,
  }),
}));
vi.mock("@/server/inbox/lead-activity", () => ({ onLeadActivity: vi.fn() }));
vi.mock("@/server/ai/worker", () => ({ kickAgentWorker: vi.fn() }));
// The business Nea (BOT_API_KEY) serves: `principal` in production.
let legacyOrganizationId: string | null = null;
vi.mock("@/server/auth/on-signup", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/auth/on-signup")>()),
  resolveLegacyOrganizationId: async () => legacyOrganizationId,
}));

import { schema } from "@/lib/db";
import { resetEnvCacheForTests } from "@/lib/env";
import { onUserCreated } from "@/server/auth/on-signup";
import { ingestInboundMessage } from "@/server/inbox/ingest";
import { canAgentRespondNow } from "@/server/business-hours";
import { cerebroExternoAtiende } from "@/server/agencia/cerebro-externo";
import { getSystemState } from "@/server/agencia/estado";

const TEAM_HOURS = Object.fromEntries(
  ["mon", "tue", "wed", "thu", "fri", "sat"].map((day) => [day, [{ start: "09:00", end: "18:00" }]]),
);

async function signUp(timezone?: string) {
  await onUserCreated("user_owner_1", "Taller Pérez", { timezone });
  return rowsOf(schema.organization)[0]?.id as string;
}

async function receiveMessage(organizationId: string) {
  await ingestInboundMessage({
    organizationId,
    identity: { identity: "5215511111111", phone: "5215511111111", waUserId: null, profileName: "Ana" },
    waMessageId: "wamid.default-tenant",
    type: "text",
    text: "Hola, ¿siguen abiertos?",
    timestamp: String(Math.floor(Date.now() / 1000)),
  });
}

async function signUpAndReceiveMessage() {
  const organizationId = await signUp();
  await receiveMessage(organizationId);
  return organizationId;
}

describe("new SaaS tenant with default settings", () => {
  beforeEach(() => {
    tables.clear();
    vi.stubEnv("APP_BASE_URL", "http://localhost:3000");
    vi.stubEnv("DATABASE_URL", "postgresql://t:t@localhost:5432/t");
    vi.stubEnv("BETTER_AUTH_SECRET", "secret-de-test-suficiente");
    vi.stubEnv("ENCRYPTION_KEY", Buffer.alloc(32, 8).toString("base64"));
    vi.stubEnv("META_WEBHOOK_VERIFY_TOKEN", "verify-test");
    vi.stubEnv("ALLOK_SAAS_MODE", "true");
    vi.stubEnv("BOT_API_KEY", "");
    resetEnvCacheForTests();
    legacyOrganizationId = "org_principal";
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetEnvCacheForTests();
  });

  it("queues an agent_job for an inbound message and is allowed to answer", async () => {
    const organizationId = await signUpAndReceiveMessage();

    const [profile] = rowsOf(schema.agentProfile);
    expect(profile).toMatchObject({ enabled: true, responseMode: "outside_hours" });
    expect(profile?.businessHours).toEqual(TEAM_HOURS);
    // No browser zone: the column default (America/Mexico_City) applies.
    expect(profile).not.toHaveProperty("businessTimezone");

    const [conversation] = rowsOf(schema.conversation);
    expect(conversation).toMatchObject({ organizationId, aiEnabled: true });
    expect(rowsOf(schema.agentJob)).toEqual([
      expect.objectContaining({ organizationId, conversationId: conversation?.id }),
    ]);

    // Team hours Mon-Sat 09-18 America/Mexico_City (UTC-6); the agent covers the rest.
    expect(await canAgentRespondNow(organizationId, new Date("2026-09-23T02:00:00Z"))).toBe(true); // Tue 20:00
    expect(await canAgentRespondNow(organizationId, new Date("2026-09-27T18:00:00Z"))).toBe(true); // Sun 12:00
    expect(await canAgentRespondNow(organizationId, new Date("2026-09-22T17:00:00Z"))).toBe(false); // Tue 11:00
    expect(await canAgentRespondNow(organizationId, new Date("2026-09-26T16:00:00Z"))).toBe(false); // Sat 10:00
  });

  it("seeds the schedule in the browser's time zone and ignores an invalid one", async () => {
    const organizationId = await signUp("America/Caracas");

    expect(rowsOf(schema.agentProfile)[0]).toMatchObject({ businessTimezone: "America/Caracas" });
    // Tue 19:00 in Caracas: the team is gone, the agent answers.
    expect(await canAgentRespondNow(organizationId, new Date("2026-09-22T23:00:00Z"))).toBe(true);

    tables.clear();
    await signUp("Mars/Base");
    expect(rowsOf(schema.agentProfile)[0]).not.toHaveProperty("businessTimezone");
  });

  it("still gets its agent when BOT_API_KEY is set for Nea", async () => {
    vi.stubEnv("BOT_API_KEY", "clave-del-cerebro-externo-larga");

    const organizationId = await signUpAndReceiveMessage();

    expect(rowsOf(schema.agentJob)).toEqual([expect.objectContaining({ organizationId })]);
  });

  it("Nea's key does not override an owner who turned the agent off", async () => {
    vi.stubEnv("BOT_API_KEY", "clave-del-cerebro-externo-larga");
    const organizationId = await signUp();
    Object.assign(rowsOf(schema.agentProfile)[0]!, { enabled: false });
    Object.assign(rowsOf(schema.organization)[0]!, {
      metadata: JSON.stringify({ allok: { billing: { plan: "basic", status: "active" } } }),
    });
    rowsOf(schema.metaCredentials).push({ organizationId, status: "connected" });

    expect((await getSystemState(organizationId, true)).state).toBe("pausado");
    await receiveMessage(organizationId);
    expect(rowsOf(schema.conversation)[0]).toMatchObject({ aiEnabled: false });
  });

  it("leaves principal to Nea when BOT_API_KEY is set", async () => {
    vi.stubEnv("BOT_API_KEY", "clave-del-cerebro-externo-larga");
    const organizationId = await signUp();
    legacyOrganizationId = organizationId;

    await receiveMessage(organizationId);

    expect(rowsOf(schema.agentJob)).toEqual([]);
  });

  it("a dedicated instance with BOT_API_KEY stays with its external brain", async () => {
    vi.stubEnv("ALLOK_SAAS_MODE", "");
    vi.stubEnv("BOT_API_KEY", "clave-del-cerebro-externo-larga");

    expect(await cerebroExternoAtiende("org_any")).toBe(true);
  });

  it("legacy signup keeps the always-on agent without a schedule", async () => {
    vi.stubEnv("ALLOK_SAAS_MODE", "");

    await onUserCreated("user_owner_1", "Taller Pérez");

    expect(rowsOf(schema.agentProfile)[0]).not.toHaveProperty("businessHours");
  });
});

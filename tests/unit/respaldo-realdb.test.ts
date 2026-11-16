import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Fork — respaldo (si en N minutos nadie contesta, contesta el agente),
 * contra Postgres DE VERDAD (se salta sin `REALDB_TEST_DATABASE_URL`):
 *
 *   REALDB_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:PUERTO/db \
 *     pnpm exec vitest run tests/unit/respaldo-realdb.test.ts
 */

const REALDB_URL = process.env.REALDB_TEST_DATABASE_URL;
const describeReal = REALDB_URL ? describe : describe.skip;

vi.mock("@/server/agencia/entitlements", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/agencia/entitlements")>()),
  hasSaaSPlan: vi.fn(async () => true),
}));

const SFX = Date.now().toString(36);
const ORG = `org_resp_${SFX}`;
const MIN = 60_000;
const ago = (minutes: number) => new Date(Date.now() - minutes * MIN);

type Mod = {
  db: ReturnType<typeof import("@/lib/db").getDb>;
  schema: typeof import("@/lib/db").schema;
  eq: typeof import("drizzle-orm").eq;
  ids: typeof import("@/lib/db/ids");
  esperando: typeof import("@/server/agencia/clientes-esperando");
  hours: typeof import("@/server/business-hours");
};
let m: Mod;
let seq = 0;

type Msg = {
  minutesAgo: number;
  direction: "in" | "out";
  origin?: "ai" | "operator" | "manual";
  status?: "sent" | "failed";
};

async function conv(msgs: Msg[]) {
  const tag = String(100 + seq++);
  const contactId = m.ids.newId("contact");
  const id = m.ids.newId("conversation");
  await m.db.insert(m.schema.contact).values({
    id: contactId,
    organizationId: ORG,
    waIdentity: `59171${SFX.replace(/\D/g, "").padStart(3, "0").slice(-3)}${tag}`,
    name: `Cliente ${tag}`,
  });
  const ins = msgs.filter((x) => x.direction === "in").map((x) => ago(x.minutesAgo).getTime());
  const all = msgs.map((x) => ago(x.minutesAgo).getTime());
  await m.db.insert(m.schema.conversation).values({
    id,
    organizationId: ORG,
    contactId,
    aiEnabled: true,
    lastInboundAt: ins.length ? new Date(Math.max(...ins)) : null,
    lastMessageAt: all.length ? new Date(Math.max(...all)) : null,
  });
  for (const x of msgs) {
    await m.db.insert(m.schema.message).values({
      id: m.ids.newId("message"),
      organizationId: ORG,
      conversationId: id,
      direction: x.direction,
      origin: x.origin ?? "operator",
      status: x.status ?? "sent",
      text: "hola",
      createdAt: ago(x.minutesAgo),
    });
  }
  return id;
}

const ALL_WEEK_24H = Object.fromEntries(
  ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => [d, [{ start: "00:00", end: "00:00" }]]),
);

describeReal("respaldo — Postgres real", { timeout: 30_000 }, () => {
  beforeAll(async () => {
    Object.assign(process.env, {
      DATABASE_URL: REALDB_URL,
      ALLOK_SAAS_MODE: "true",
      APP_BASE_URL: "http://localhost:3999",
      BETTER_AUTH_SECRET: "x".repeat(32),
      ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
      META_WEBHOOK_VERIFY_TOKEN: "resp-verify",
      META_APP_SECRET: "resp-secret",
      META_GRAPH_BASE_URL: "http://graph.invalid",
    });
    const { resetEnvCacheForTests } = await import("@/lib/env");
    resetEnvCacheForTests();
    const dbMod = await import("@/lib/db");
    m = {
      db: dbMod.getDb(),
      schema: dbMod.schema,
      eq: (await import("drizzle-orm")).eq,
      ids: await import("@/lib/db/ids"),
      esperando: await import("@/server/agencia/clientes-esperando"),
      hours: await import("@/server/business-hours"),
    };
    await m.db.insert(m.schema.organization).values({ id: ORG, name: ORG, slug: ORG });
    // El equipo atiende las 24 h, en «Cuando no atiendes tú», con respaldo a los 5 min:
    // sin respaldo el agente no contestaría nunca.
    await m.db.insert(m.schema.agentProfile).values({
      id: m.ids.newId("agentProfile"),
      organizationId: ORG,
      businessHours: ALL_WEEK_24H,
      businessTimezone: "America/La_Paz",
      responseMode: "outside_hours",
      backupMinutes: 5,
    });
  }, 60_000);

  afterEach(() => m.esperando.resetClientesEsperandoForTests());

  afterAll(async () => {
    await m.db.delete(m.schema.organization).where(m.eq(m.schema.organization.id, ORG));
  });

  it("lee desde cuándo espera el cliente y si la última respuesta fue del agente", async () => {
    const rafaga = await conv([
      { minutesAgo: 9, direction: "in" },
      { minutesAgo: 7, direction: "in" },
      { minutesAgo: 2, direction: "in" },
    ]);
    const e1 = await m.hours.esperaDelCliente(ORG, rafaga);
    expect(Math.round((Date.now() - e1.desde!.getTime()) / MIN)).toBe(9);
    expect(e1.ultimaDelAgente).toBeNull();

    const conAgente = await conv([
      { minutesAgo: 10, direction: "in" },
      { minutesAgo: 9, direction: "out", origin: "ai" },
      { minutesAgo: 1, direction: "in" },
    ]);
    const e2 = await m.hours.esperaDelCliente(ORG, conAgente);
    expect(Math.round((Date.now() - e2.desde!.getTime()) / MIN)).toBe(1);
    expect(Math.round((Date.now() - e2.ultimaDelAgente!.getTime()) / MIN)).toBe(9);

    const fallido = await conv([
      { minutesAgo: 8, direction: "in" },
      { minutesAgo: 7, direction: "out", origin: "operator", status: "failed" },
    ]);
    const e3 = await m.hours.esperaDelCliente(ORG, fallido);
    expect(Math.round((Date.now() - e3.desde!.getTime()) / MIN)).toBe(8);

    const contestado = await conv([
      { minutesAgo: 8, direction: "in" },
      { minutesAgo: 7, direction: "out", origin: "manual" },
    ]);
    expect((await m.hours.esperaDelCliente(ORG, contestado)).desde).toBeNull();
  });

  it("el turno: calla a los 2 min, contesta a los 6, y sigue la charla que ya lleva", async () => {
    const nuevo = await conv([{ minutesAgo: 2, direction: "in" }]);
    const esperando = await conv([{ minutesAgo: 6, direction: "in" }]);
    const charla = await conv([
      { minutesAgo: 6, direction: "in" },
      { minutesAgo: 3, direction: "out", origin: "ai" },
      { minutesAgo: 0.2, direction: "in" },
    ]);
    expect(await m.hours.canAgentAnswerConversation(ORG, nuevo)).toBe(false);
    expect(await m.hours.canAgentAnswerConversation(ORG, esperando)).toBe(true);
    expect(await m.hours.canAgentAnswerConversation(ORG, charla)).toBe(true);
  });

  it("el barrido pide el turno a quien ya esperó, no al que lleva 4 min ni al chat del equipo", async () => {
    const cuatro = await conv([{ minutesAgo: 4, direction: "in" }]);
    const seis = await conv([{ minutesAgo: 6, direction: "in" }]);
    const delEquipo = await conv([
      { minutesAgo: 60, direction: "in" },
      { minutesAgo: 50, direction: "out", origin: "manual" },
      { minutesAgo: 20, direction: "in" },
    ]);
    const schedule = vi.fn(async () => {});
    await m.esperando.barrerClientesEsperando(schedule);
    expect(schedule).toHaveBeenCalledWith(seis, ORG);
    expect(schedule).not.toHaveBeenCalledWith(cuatro, ORG);
    expect(schedule).not.toHaveBeenCalledWith(delEquipo, ORG);
  });

  it("sin respaldo, el mismo cliente espera al equipo", async () => {
    const seis = await conv([{ minutesAgo: 6, direction: "in" }]);
    await m.db
      .update(m.schema.agentProfile)
      .set({ backupMinutes: null })
      .where(m.eq(m.schema.agentProfile.organizationId, ORG));
    expect(await m.hours.canAgentAnswerConversation(ORG, seis)).toBe(false);
    const schedule = vi.fn(async () => {});
    await m.esperando.barrerClientesEsperando(schedule);
    expect(schedule).not.toHaveBeenCalledWith(seis, ORG);
  });
});

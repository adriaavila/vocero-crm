import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Fork — nadie se queda esperando cuando termina el horario del equipo,
 * contra Postgres DE VERDAD (se salta sin `REALDB_TEST_DATABASE_URL`):
 *
 *   REALDB_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:PUERTO/db \
 *     pnpm exec vitest run tests/unit/clientes-esperando-realdb.test.ts
 */

const REALDB_URL = process.env.REALDB_TEST_DATABASE_URL;
const describeReal = REALDB_URL ? describe : describe.skip;

const hoisted = vi.hoisted(() => ({ abierto: true }));
vi.mock("@/server/business-hours", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/business-hours")>()),
  canAgentRespondNow: vi.fn(async () => hoisted.abierto),
}));

const SFX = Date.now().toString(36);
const ORG = `org_esp_${SFX}`;
const MIN = 60_000;
const ago = (minutes: number) => new Date(Date.now() - minutes * MIN);

type Mod = {
  db: ReturnType<typeof import("@/lib/db").getDb>;
  schema: typeof import("@/lib/db").schema;
  eq: typeof import("drizzle-orm").eq;
  ids: typeof import("@/lib/db/ids");
  esperando: typeof import("@/server/agencia/clientes-esperando");
};
let m: Mod;
let seq = 0;

type Msg = { minutesAgo: number; direction: "in" | "out"; origin?: "ai" | "operator" | "manual" };

/** Una conversación con sus mensajes; `lastInboundAt`/`lastMessageAt` salen de ellos. */
async function conv(msgs: Msg[], over: Partial<typeof import("@/lib/db").schema.conversation.$inferInsert> = {}) {
  const tag = String(100 + seq++);
  const contactId = m.ids.newId("contact");
  const id = m.ids.newId("conversation");
  await m.db.insert(m.schema.contact).values({
    id: contactId,
    organizationId: ORG,
    waIdentity: `58414${SFX.replace(/\D/g, "").padStart(3, "0").slice(-3)}${tag}`,
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
    ...over,
  });
  for (const x of msgs) {
    await m.db.insert(m.schema.message).values({
      id: m.ids.newId("message"),
      organizationId: ORG,
      conversationId: id,
      direction: x.direction,
      origin: x.origin ?? "operator",
      text: "hola",
      createdAt: ago(x.minutesAgo),
    });
  }
  return id;
}

async function esperandoIds(): Promise<string[]> {
  return (await m.esperando.clientesEsperando()).filter((c) => c.organizationId === ORG).map((c) => c.conversationId);
}

describeReal("clientes esperando — Postgres real", { timeout: 30_000 }, () => {
  beforeAll(async () => {
    Object.assign(process.env, {
      DATABASE_URL: REALDB_URL,
      APP_BASE_URL: "http://localhost:3999",
      BETTER_AUTH_SECRET: "x".repeat(32),
      ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
      META_WEBHOOK_VERIFY_TOKEN: "esp-verify",
      META_APP_SECRET: "esp-secret",
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
    };
    await m.db.insert(m.schema.organization).values({ id: ORG, name: ORG, slug: ORG });
  }, 60_000);

  afterEach(() => {
    hoisted.abierto = true;
    m.esperando.resetClientesEsperandoForTests();
  });

  afterAll(async () => {
    await m.db.delete(m.schema.organization).where(m.eq(m.schema.organization.id, ORG));
  });

  it("encuentra al cliente que escribió y nadie contestó, y respeta lo demás", async () => {
    const sinRespuesta = await conv([{ minutesAgo: 40, direction: "in" }]);
    const conBot = await conv([
      { minutesAgo: 40, direction: "in" },
      { minutesAgo: 39, direction: "out", origin: "ai" },
    ]);
    const recien = await conv([{ minutesAgo: 1, direction: "in" }]);
    const viejo = await conv([{ minutesAgo: 13 * 60, direction: "in" }]);
    const traspaso = await conv([{ minutesAgo: 40, direction: "in" }], { handoffAt: ago(40), handoffReason: "cliente" });
    const iaApagada = await conv([{ minutesAgo: 40, direction: "in" }], { aiEnabled: false });
    const prueba = await conv([{ minutesAgo: 40, direction: "in" }], { isTest: true });
    const charlaHumana = await conv([
      { minutesAgo: 90, direction: "in" },
      { minutesAgo: 80, direction: "out", origin: "manual" },
      { minutesAgo: 40, direction: "in" },
    ]);
    const botAntes = await conv([
      { minutesAgo: 120, direction: "in" },
      { minutesAgo: 119, direction: "out", origin: "ai" },
      { minutesAgo: 40, direction: "in" },
    ]);

    const ids = await esperandoIds();
    expect(ids).toContain(sinRespuesta);
    expect(ids).toContain(botAntes);
    for (const no of [conBot, recien, viejo, traspaso, iaApagada, prueba, charlaHumana]) {
      expect(ids).not.toContain(no);
    }
  });

  it("si el agente ya decidió (aunque fuera callar), no lo vuelve a intentar", async () => {
    const id = await conv([{ minutesAgo: 30, direction: "in" }]);
    expect(await esperandoIds()).toContain(id);
    await m.db.insert(m.schema.agentDecision).values({
      id: m.ids.newId("agentDecision"),
      organizationId: ORG,
      conversationId: id,
      brain: "rei",
      action: "none",
      createdAt: ago(29),
    });
    expect(await esperandoIds()).not.toContain(id);
  });

  it("con un turno ya en cola, no encola otro", async () => {
    const id = await conv([{ minutesAgo: 30, direction: "in" }]);
    await m.db.insert(m.schema.agentJob).values({ id: m.ids.newId("agentJob"), organizationId: ORG, conversationId: id });
    expect(await esperandoIds()).not.toContain(id);
  });

  it("el barrido pide el turno solo cuando el agente puede hablar, y una vez por mensaje", async () => {
    const id = await conv([{ minutesAgo: 20, direction: "in" }]);
    const schedule = vi.fn(async () => {});

    hoisted.abierto = false;
    await m.esperando.barrerClientesEsperando(schedule);
    expect(schedule).not.toHaveBeenCalledWith(id, ORG);

    hoisted.abierto = true;
    await m.esperando.barrerClientesEsperando(schedule);
    expect(schedule).toHaveBeenCalledWith(id, ORG);

    schedule.mockClear();
    await m.esperando.barrerClientesEsperando(schedule);
    expect(schedule).not.toHaveBeenCalledWith(id, ORG);
  });
});

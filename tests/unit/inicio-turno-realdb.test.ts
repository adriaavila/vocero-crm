import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Inicio y el horario del agente contra Postgres DE VERDAD (opcional: se salta
 * sin `REALDB_TEST_DATABASE_URL`, igual que centro-realdb.test.ts):
 *
 *   REALDB_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:PUERTO/db \
 *     pnpm exec vitest run tests/unit/inicio-turno-realdb.test.ts
 *
 * Con «Solo cuando no atiendes tú», en horas del equipo el agente calla: quien
 * acaba de escribir espera por una persona. Antes Inicio decía «allok está
 * respondiendo» diez minutos y nadie le contestaba a ese cliente.
 */

const REALDB_URL = process.env.REALDB_TEST_DATABASE_URL;
const describeReal = REALDB_URL ? describe : describe.skip;

const SFX = Date.now().toString(36);
const ORG = `org_turno_${SFX}`;
const MIN = 60_000;
const H = 60 * MIN;

// Hoy en Ciudad de México (UTC-6 todo el año): a las 11:00 atiende el equipo y
// a las 20:00 el agente. Cerca de la fecha real, para que nada caiga fuera de
// una ventana que se mida con el reloj de la base.
const todayUtc = new Date().toISOString().slice(0, 10);
const TEAM_TIME = new Date(`${todayUtc}T17:00:00Z`);
const AGENT_TIME = new Date(TEAM_TIME.getTime() + 9 * H);
const EVERY_DAY_9_TO_18 = Object.fromEntries(
  ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((day) => [day, [{ start: "09:00", end: "18:00" }]]),
);

type Mod = {
  db: ReturnType<typeof import("@/lib/db").getDb>;
  schema: typeof import("@/lib/db").schema;
  eq: typeof import("drizzle-orm").eq;
  ids: typeof import("@/lib/db/ids");
  prio: typeof import("@/server/agencia/prioridades");
  estado: typeof import("@/server/agencia/estado");
};
let m: Mod;
let seq = 0;

/** Un cliente que escribió hace un minuto y nadie le contestó todavía. */
async function justWrote(at: Date): Promise<string> {
  const n = ++seq;
  const contactId = m.ids.newId("contact");
  const id = m.ids.newId("conversation");
  const inbound = new Date(at.getTime() - MIN);
  await m.db.insert(m.schema.contact).values({
    id: contactId,
    organizationId: ORG,
    waIdentity: `5255${SFX.replace(/\D/g, "").slice(-4)}${n}`.slice(0, 20),
    name: `Cliente ${n}`,
  });
  await m.db.insert(m.schema.conversation).values({
    id,
    organizationId: ORG,
    contactId,
    aiEnabled: true,
    lastInboundAt: inbound,
    lastMessageAt: inbound,
  });
  await m.db.insert(m.schema.message).values({
    id: m.ids.newId("message"),
    organizationId: ORG,
    conversationId: id,
    direction: "in",
    type: "text",
    text: "Hola, ¿tienen cita mañana?",
    status: "delivered",
    createdAt: inbound,
    waTimestamp: inbound,
  });
  return id;
}

async function setMode(responseMode: "outside_hours" | "all_day") {
  await m.db
    .update(m.schema.agentProfile)
    .set({ responseMode })
    .where(m.eq(m.schema.agentProfile.organizationId, ORG));
}

describeReal("Inicio y el turno del agente — Postgres real", { timeout: 30_000 }, () => {
  beforeAll(async () => {
    Object.assign(process.env, {
      DATABASE_URL: REALDB_URL,
      APP_BASE_URL: "http://localhost:3999",
      BETTER_AUTH_SECRET: "x".repeat(32),
      ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
      META_WEBHOOK_VERIFY_TOKEN: "turno-verify-token",
      ALLOK_SAAS_MODE: "true",
    });
    const { resetEnvCacheForTests } = await import("@/lib/env");
    resetEnvCacheForTests();
    const dbMod = await import("@/lib/db");
    m = {
      db: dbMod.getDb(),
      schema: dbMod.schema,
      eq: (await import("drizzle-orm")).eq,
      ids: await import("@/lib/db/ids"),
      prio: await import("@/server/agencia/prioridades"),
      estado: await import("@/server/agencia/estado"),
    };
    await m.db.insert(m.schema.organization).values({ id: ORG, name: ORG, slug: ORG });
    // La prueba de autoservicio: Completo, con las respuestas sin gastar.
    const { startSelfServeTrial } = await import("@/server/saas/billing");
    await startSelfServeTrial(ORG, new Date(TEAM_TIME.getTime() - 2 * H));
    await m.db.insert(m.schema.agentProfile).values({
      id: m.ids.newId("agentProfile"),
      organizationId: ORG,
      enabled: true,
      name: "Asistente",
      businessHours: EVERY_DAY_9_TO_18,
      businessTimezone: "America/Mexico_City",
      responseMode: "outside_hours",
    });
    // Solo `Date` es de mentira: los temporizadores del driver siguen reales.
    vi.useFakeTimers({ toFake: ["Date"] });
  });

  afterAll(async () => {
    vi.useRealTimers();
    if (m) await m.db.delete(m.schema.organization).where(m.eq(m.schema.organization.id, ORG));
  });

  it("en horas del equipo, quien acaba de escribir te espera a ti y la tarjeta dice quién atiende", async () => {
    vi.setSystemTime(TEAM_TIME);
    const id = await justWrote(TEAM_TIME);

    expect(await m.estado.agentAnswersNow(ORG)).toBe(false);
    const snap = await m.estado.getSystemState(ORG, true);
    expect(snap.waiting).toBe(1);
    expect(snap.working).toBe(0);

    const queue = await m.prio.getPrioridades(ORG, { agentOn: false, now: TEAM_TIME });
    expect(queue.stateById[id]).toBe("atencion");
    const centro = await m.estado.getCentro(ORG, queue.stateById);
    expect(centro.day.offShift).toBe("Ahora atiendes tú. Tu agente empieza a responder hoy a las 18:00.");

    await m.db.delete(m.schema.conversation).where(m.eq(m.schema.conversation.id, id));
  });

  it("en el turno del agente, el que acaba de escribir lo tiene el agente", async () => {
    vi.setSystemTime(AGENT_TIME);
    const id = await justWrote(AGENT_TIME);

    expect(await m.estado.agentAnswersNow(ORG)).toBe(true);
    const snap = await m.estado.getSystemState(ORG, true);
    expect(snap.waiting).toBe(0);
    expect(snap.working).toBe(1);
    expect((await m.estado.getCentro(ORG, {})).day.offShift).toBeNull();

    await m.db.delete(m.schema.conversation).where(m.eq(m.schema.conversation.id, id));
  });

  it("con «todo el día» en la prueba (Completo), contesta también en horas del equipo", async () => {
    await setMode("all_day");
    vi.setSystemTime(TEAM_TIME);
    const id = await justWrote(TEAM_TIME);

    expect(await m.estado.agentAnswersNow(ORG)).toBe(true);
    expect((await m.estado.getSystemState(ORG, true)).working).toBe(1);
    expect((await m.estado.getCentro(ORG, {})).day.offShift).toBeNull();

    await m.db.delete(m.schema.conversation).where(m.eq(m.schema.conversation.id, id));
    await setMode("outside_hours");
  });
});

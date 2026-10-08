import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Fork — seguimiento: qué conversaciones son candidatas, contra Postgres DE
 * VERDAD (se salta sin `REALDB_TEST_DATABASE_URL`):
 *
 *   REALDB_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:PUERTO/db \
 *     pnpm exec vitest run tests/unit/seguimiento-realdb.test.ts
 */

const REALDB_URL = process.env.REALDB_TEST_DATABASE_URL;
const describeReal = REALDB_URL ? describe : describe.skip;

const SFX = Date.now().toString(36);
const ORG = `org_seg_${SFX}`;
const ORG_OFF = `org_segoff_${SFX}`;
const H = 3_600_000;
const ago = (hours: number) => new Date(Date.now() - hours * H);

type Mod = {
  db: ReturnType<typeof import("@/lib/db").getDb>;
  schema: typeof import("@/lib/db").schema;
  eq: typeof import("drizzle-orm").eq;
  ids: typeof import("@/lib/db/ids");
  seg: typeof import("@/server/agencia/seguimiento");
};
let m: Mod;
let seq = 0;

type Msg = { hoursAgo: number; direction: "in" | "out"; origin?: "ai" | "operator" | "manual" };

async function conv(org: string, msgs: Msg[], over: { stage?: "won" | "open"; isTest?: boolean } = {}) {
  const tag = String(100 + seq++);
  const contactId = m.ids.newId("contact");
  const id = m.ids.newId("conversation");
  await m.db.insert(m.schema.contact).values({
    id: contactId,
    organizationId: org,
    waIdentity: `58416${SFX.replace(/\D/g, "").padStart(3, "0").slice(-3)}${tag}`,
    name: `Cliente ${tag}`,
  });
  const ins = msgs.filter((x) => x.direction === "in").map((x) => ago(x.hoursAgo).getTime());
  const all = msgs.map((x) => ago(x.hoursAgo).getTime());
  await m.db.insert(m.schema.conversation).values({
    id,
    organizationId: org,
    contactId,
    aiEnabled: true,
    isTest: over.isTest ?? false,
    lastInboundAt: new Date(Math.max(...ins)),
    lastMessageAt: new Date(Math.max(...all)),
  });
  for (const x of msgs) {
    await m.db.insert(m.schema.message).values({
      id: m.ids.newId("message"),
      organizationId: org,
      conversationId: id,
      direction: x.direction,
      origin: x.origin ?? "operator",
      text: "hola",
      createdAt: ago(x.hoursAgo),
    });
  }
  if (over.stage) {
    await m.db.insert(m.schema.lead).values({
      id: m.ids.newId("lead"),
      organizationId: org,
      contactId,
      stageId: `stg_${over.stage}_${org}`,
    });
  }
  return id;
}

async function candidatos(): Promise<string[]> {
  return (await m.seg.candidatosSeguimiento()).map((c) => c.conversationId);
}

describeReal("seguimiento — candidatos en Postgres real", { timeout: 30_000 }, () => {
  beforeAll(async () => {
    Object.assign(process.env, {
      DATABASE_URL: REALDB_URL,
      APP_BASE_URL: "http://localhost:3999",
      BETTER_AUTH_SECRET: "x".repeat(32),
      ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
      META_WEBHOOK_VERIFY_TOKEN: "seg-verify",
      META_APP_SECRET: "seg-secret",
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
      seg: await import("@/server/agencia/seguimiento"),
    };
    for (const org of [ORG, ORG_OFF]) {
      await m.db.insert(m.schema.organization).values({ id: org, name: org, slug: org });
      for (const kind of ["open", "won"] as const) {
        await m.db.insert(m.schema.pipelineStage).values({
          id: `stg_${kind}_${org}`,
          organizationId: org,
          name: kind,
          position: kind === "open" ? 0 : 1,
          kind,
        });
      }
      await m.db.insert(m.schema.agentProfile).values({
        id: m.ids.newId("agentProfile"),
        organizationId: org,
        enabled: true,
        name: "Asistente",
        followUpHours: org === ORG ? 4 : null,
      });
    }
  }, 60_000);

  afterAll(async () => {
    for (const org of [ORG, ORG_OFF]) {
      await m.db.delete(m.schema.organization).where(m.eq(m.schema.organization.id, org));
    }
  });

  it("encuentra al que calló tras la respuesta del agente, y respeta lo demás", async () => {
    const callado = await conv(ORG, [
      { hoursAgo: 6, direction: "in" },
      { hoursAgo: 5.9, direction: "out", origin: "ai" },
    ]);
    const pronto = await conv(ORG, [
      { hoursAgo: 2, direction: "in" },
      { hoursAgo: 1.9, direction: "out", origin: "ai" },
    ]);
    const persona = await conv(ORG, [
      { hoursAgo: 6, direction: "in" },
      { hoursAgo: 5.9, direction: "out", origin: "manual" },
    ]);
    const ventana = await conv(ORG, [
      { hoursAgo: 30, direction: "in" },
      { hoursAgo: 29.9, direction: "out", origin: "ai" },
    ]);
    const ganado = await conv(
      ORG,
      [
        { hoursAgo: 6, direction: "in" },
        { hoursAgo: 5.9, direction: "out", origin: "ai" },
      ],
      { stage: "won" }
    );
    const abierto = await conv(
      ORG,
      [
        { hoursAgo: 6, direction: "in" },
        { hoursAgo: 5.9, direction: "out", origin: "ai" },
      ],
      { stage: "open" }
    );
    const prueba = await conv(
      ORG,
      [
        { hoursAgo: 6, direction: "in" },
        { hoursAgo: 5.9, direction: "out", origin: "ai" },
      ],
      { isTest: true }
    );
    const apagado = await conv(ORG_OFF, [
      { hoursAgo: 6, direction: "in" },
      { hoursAgo: 5.9, direction: "out", origin: "ai" },
    ]);

    const ids = await candidatos();
    expect(ids).toContain(callado);
    expect(ids).toContain(abierto);
    for (const no of [pronto, persona, ventana, ganado, prueba, apagado]) expect(ids).not.toContain(no);
  });

  it("una vez por silencio: tras decidir, deja de ser candidata hasta que el cliente vuelva", async () => {
    const id = await conv(ORG, [
      { hoursAgo: 8, direction: "in" },
      { hoursAgo: 7.9, direction: "out", origin: "ai" },
    ]);
    expect(await candidatos()).toContain(id);
    await m.db.insert(m.schema.agentDecision).values({
      id: m.ids.newId("agentDecision"),
      organizationId: ORG,
      conversationId: id,
      brain: "rei",
      action: "follow_up_skip",
      createdAt: ago(1),
    });
    expect(await candidatos()).not.toContain(id);
  });

  it("el ajuste se guarda normalizado: 0 apaga", async () => {
    expect(await m.seg.saveSeguimiento(ORG_OFF, 8)).toBe(8);
    expect(await m.seg.getSeguimiento(ORG_OFF)).toBe(8);
    expect(await m.seg.saveSeguimiento(ORG_OFF, 0)).toBeNull();
    expect(await m.seg.getSeguimiento(ORG_OFF)).toBeNull();
  });
});

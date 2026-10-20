import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Fork — recuperar clientes: a quién le escribiría el agente, contra Postgres
 * DE VERDAD (se salta sin `REALDB_TEST_DATABASE_URL`):
 *
 *   REALDB_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:PUERTO/db \
 *     pnpm exec vitest run tests/unit/recuperar-realdb.test.ts
 */

const REALDB_URL = process.env.REALDB_TEST_DATABASE_URL;
const describeReal = REALDB_URL ? describe : describe.skip;

const SFX = Date.now().toString(36);
const ORG = `org_rec_${SFX}`;
const ORG_OFF = `org_recoff_${SFX}`;
const D = 86_400_000;
const daysAgo = (days: number) => new Date(Date.now() - days * D);

type Mod = {
  db: ReturnType<typeof import("@/lib/db").getDb>;
  schema: typeof import("@/lib/db").schema;
  eq: typeof import("drizzle-orm").eq;
  ids: typeof import("@/lib/db/ids");
  rec: typeof import("@/server/agencia/recuperar");
};
let m: Mod;
let seq = 0;

type Over = {
  silencio?: number;
  booking?: { status: "realizada" | "agendada" | "cancelada"; daysAgo: number; isTest?: boolean };
  won?: boolean;
  isTest?: boolean;
  archived?: boolean;
  aiEnabled?: boolean;
};

async function cliente(org: string, over: Over = {}) {
  const tag = String(100 + seq++);
  const contactId = m.ids.newId("contact");
  const id = m.ids.newId("conversation");
  const silencio = over.silencio ?? 120;
  await m.db.insert(m.schema.contact).values({
    id: contactId,
    organizationId: org,
    waIdentity: `58426${SFX.replace(/\D/g, "").padStart(3, "0").slice(-3)}${tag}`,
    name: `Cliente ${tag}`,
    archivedAt: over.archived ? new Date() : null,
  });
  await m.db.insert(m.schema.conversation).values({
    id,
    organizationId: org,
    contactId,
    aiEnabled: over.aiEnabled ?? true,
    isTest: over.isTest ?? false,
    lastInboundAt: daysAgo(silencio),
    lastMessageAt: daysAgo(silencio - 0.01),
  });
  if (over.booking) {
    await m.db.insert(m.schema.booking).values({
      id: m.ids.newId("booking"),
      organizationId: org,
      contactId,
      conversationId: id,
      status: over.booking.status,
      scheduledAt: daysAgo(over.booking.daysAgo),
      durationMinutes: 30,
      isTest: over.booking.isTest ?? false,
    });
  }
  if (over.won) {
    await m.db.insert(m.schema.lead).values({
      id: m.ids.newId("lead"),
      organizationId: org,
      contactId,
      stageId: `stg_won_${org}`,
    });
  }
  return id;
}

async function candidatos(): Promise<string[]> {
  return (await m.rec.candidatosRecuperar()).map((c) => c.conversationId);
}

describeReal("recuperar clientes — candidatos en Postgres real", { timeout: 30_000 }, () => {
  beforeAll(async () => {
    Object.assign(process.env, {
      DATABASE_URL: REALDB_URL,
      APP_BASE_URL: "http://localhost:3999",
      BETTER_AUTH_SECRET: "x".repeat(32),
      ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
      META_WEBHOOK_VERIFY_TOKEN: "rec-verify",
      META_APP_SECRET: "rec-secret",
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
      rec: await import("@/server/agencia/recuperar"),
    };
    for (const org of [ORG, ORG_OFF]) {
      await m.db.insert(m.schema.organization).values({ id: org, name: org, slug: org });
      await m.db.insert(m.schema.pipelineStage).values({
        id: `stg_won_${org}`,
        organizationId: org,
        name: "Ganado",
        position: 1,
        kind: "won",
      });
      const templateId = `tpl_rec_${org}`;
      await m.db.insert(m.schema.template).values({
        id: templateId,
        organizationId: org,
        name: `recuperar_${org}`,
        language: "es",
        category: "MARKETING",
        body: "Hola {{1}}, te extrañamos en {{2}}",
        status: "approved",
      });
      await m.db.insert(m.schema.agentProfile).values({
        id: m.ids.newId("agentProfile"),
        organizationId: org,
        enabled: true,
        name: "Asistente",
        recuperarDias: org === ORG ? 90 : null,
        recuperarTemplateId: templateId,
      });
    }
  }, 60_000);

  afterAll(async () => {
    for (const org of [ORG, ORG_OFF]) {
      await m.db.delete(m.schema.organization).where(m.eq(m.schema.organization.id, org));
    }
  });

  it("encuentra al cliente que no volvió, y respeta lo demás", async () => {
    const vino = await cliente(ORG, { booking: { status: "realizada", daysAgo: 120 } });
    const compro = await cliente(ORG, { won: true });
    const citaPasada = await cliente(ORG, { booking: { status: "agendada", daysAgo: 118 } });
    const soloPregunto = await cliente(ORG);
    const reciente = await cliente(ORG, { silencio: 30, booking: { status: "realizada", daysAgo: 40 } });
    const conCita = await cliente(ORG, { won: true, booking: { status: "agendada", daysAgo: -3 } });
    const cancelo = await cliente(ORG, { booking: { status: "cancelada", daysAgo: 120 } });
    const citaDePrueba = await cliente(ORG, { booking: { status: "realizada", daysAgo: 120, isTest: true } });
    const archivado = await cliente(ORG, { won: true, archived: true });
    const pausado = await cliente(ORG, { won: true, aiEnabled: false });
    const prueba = await cliente(ORG, { won: true, isTest: true });
    const apagado = await cliente(ORG_OFF, { won: true });

    const ids = await candidatos();
    for (const si of [vino, compro, citaPasada]) expect(ids).toContain(si);
    for (const no of [soloPregunto, reciente, conCita, cancelo, citaDePrueba, archivado, pausado, prueba, apagado]) {
      expect(ids).not.toContain(no);
    }
    // Ajustes cuenta los del negocio con los días que se están eligiendo.
    expect(await m.rec.cuantosPorRecuperar(ORG, 90)).toBe(3);
    expect(await m.rec.cuantosPorRecuperar(ORG, 20)).toBe(4);
  });

  it("una vez por silencio: tras decidir deja de ser candidato, y cuenta si volvió", async () => {
    const id = await cliente(ORG, { won: true, silencio: 200 });
    expect(await candidatos()).toContain(id);
    await m.db.insert(m.schema.agentDecision).values({
      id: m.ids.newId("agentDecision"),
      organizationId: ORG,
      conversationId: id,
      brain: "rei",
      action: "recuperar",
      createdAt: daysAgo(2),
    });
    expect(await candidatos()).not.toContain(id);
    expect(await m.rec.resultadosRecuperar(ORG)).toEqual({ escritos: 1, volvieron: 0 });
    await m.db
      .update(m.schema.conversation)
      .set({ lastInboundAt: daysAgo(1) })
      .where(m.eq(m.schema.conversation.id, id));
    expect(await m.rec.resultadosRecuperar(ORG)).toEqual({ escritos: 1, volvieron: 1 });
  });

  it("sin plantilla aprobada no hay candidatos", async () => {
    await m.db
      .update(m.schema.template)
      .set({ status: "pending" })
      .where(m.eq(m.schema.template.id, `tpl_rec_${ORG}`));
    expect((await m.rec.candidatosRecuperar()).filter((c) => c.organizationId === ORG)).toEqual([]);
    await m.db
      .update(m.schema.template)
      .set({ status: "approved" })
      .where(m.eq(m.schema.template.id, `tpl_rec_${ORG}`));
  });

  it("el ajuste se guarda normalizado: 0 apaga", async () => {
    expect(await m.rec.saveRecuperar(ORG_OFF, { dias: 60, templateId: `tpl_rec_${ORG_OFF}` })).toEqual({
      dias: 60,
      templateId: `tpl_rec_${ORG_OFF}`,
    });
    expect((await m.rec.getRecuperar(ORG_OFF)).dias).toBe(60);
    expect((await m.rec.saveRecuperar(ORG_OFF, { dias: 0, templateId: null })).dias).toBeNull();
  });
});

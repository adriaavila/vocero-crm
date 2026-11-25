import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Fork — un traspaso por visita mueve el lead, contra Postgres DE VERDAD (se
 * salta sin `REALDB_TEST_DATABASE_URL`):
 *
 *   REALDB_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:PUERTO/db \
 *     pnpm exec vitest run tests/unit/visita-pipeline-realdb.test.ts
 */

const REALDB_URL = process.env.REALDB_TEST_DATABASE_URL;
const describeReal = REALDB_URL ? describe : describe.skip;

const SFX = Date.now().toString(36);
const ORG = `org_vis_${SFX}`;
const HORA = 60 * 60_000;
const STAGES = [
  { key: "nuevo", name: "Nuevo", kind: "open" },
  { key: "calif", name: "Calificado", kind: "open" },
  { key: "vpc", name: "Visita por coordinar", kind: "open" },
  { key: "vag", name: "Visita agendada", kind: "open" },
  { key: "res", name: "Reservó", kind: "won" },
  { key: "per", name: "Perdido", kind: "lost" },
] as const;

type Mod = {
  db: ReturnType<typeof import("@/lib/db").getDb>;
  schema: typeof import("@/lib/db").schema;
  eq: typeof import("drizzle-orm").eq;
  ids: typeof import("@/lib/db/ids");
  visita: typeof import("@/server/agencia/visita-pipeline");
  pipeline: typeof import("@/server/ai/pipeline");
};
let m: Mod;
const stageId: Record<string, string> = {};
let seq = 0;

/** Un cliente con su lead en `etapa` y estos mensajes suyos (horas atrás). */
async function cliente(etapa: string, mensajes: { text: string; horas?: number }[], isTest = false) {
  const tag = String(100 + seq++);
  const contactId = m.ids.newId("contact");
  const conversationId = m.ids.newId("conversation");
  const leadId = m.ids.newId("lead");
  await m.db.insert(m.schema.contact).values({
    id: contactId,
    organizationId: ORG,
    waIdentity: `59170${SFX.replace(/\D/g, "").padStart(3, "0").slice(-3)}${tag}`,
    name: `Comprador ${tag}`,
  });
  await m.db.insert(m.schema.conversation).values({ id: conversationId, organizationId: ORG, contactId, aiEnabled: true, isTest });
  await m.db.insert(m.schema.lead).values({ id: leadId, organizationId: ORG, contactId, stageId: stageId[etapa]! });
  for (const x of mensajes) {
    await m.db.insert(m.schema.message).values({
      id: m.ids.newId("message"),
      organizationId: ORG,
      conversationId,
      direction: "in",
      text: x.text,
      createdAt: new Date(Date.now() - (x.horas ?? 0) * HORA - 1000),
    });
  }
  return { conversationId, leadId };
}

async function etapaDe(leadId: string): Promise<string | undefined> {
  const [row] = await m.db.select({ s: m.schema.lead.stageId }).from(m.schema.lead).where(m.eq(m.schema.lead.id, leadId));
  const key = Object.entries(stageId).find(([, id]) => id === row?.s)?.[0];
  return key;
}

describeReal("visita → embudo — Postgres real", { timeout: 30_000 }, () => {
  beforeAll(async () => {
    Object.assign(process.env, {
      DATABASE_URL: REALDB_URL,
      APP_BASE_URL: "http://localhost:3999",
      BETTER_AUTH_SECRET: "x".repeat(32),
      ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
      META_WEBHOOK_VERIFY_TOKEN: "vis-verify",
      META_APP_SECRET: "vis-secret",
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
      visita: await import("@/server/agencia/visita-pipeline"),
      pipeline: await import("@/server/ai/pipeline"),
    };
    await m.db.insert(m.schema.organization).values({ id: ORG, name: ORG, slug: ORG });
    for (const [i, s] of STAGES.entries()) {
      stageId[s.key] = m.ids.newId("stage");
      await m.db.insert(m.schema.pipelineStage).values({ id: stageId[s.key]!, organizationId: ORG, name: s.name, kind: s.kind, position: i });
    }
  }, 60_000);

  afterAll(async () => {
    await m.db.delete(m.schema.organization).where(m.eq(m.schema.organization.id, ORG));
  });

  it("el cliente pidió visita: va a «Visita por coordinar» y queda en la bitácora", async () => {
    const c = await cliente("nuevo", [{ text: "Hola, ¿cuánto cuesta?" }, { text: "Quiero visitar la vivienda 2 el sábado" }]);
    expect(await m.visita.moverEtapaPorVisita({ organizationId: ORG, conversationId: c.conversationId })).toEqual({ movido: true });
    expect(await etapaDe(c.leadId)).toBe("vpc");
    const eventos = await m.db
      .select({ to: m.schema.leadStageEvent.toStageName, source: m.schema.leadStageEvent.source })
      .from(m.schema.leadStageEvent)
      .where(m.eq(m.schema.leadStageEvent.leadId, c.leadId));
    expect(eventos).toContainEqual({ to: "Visita por coordinar", source: "bot" });
    // Repetirlo no lo mueve otra vez.
    expect(await m.visita.moverEtapaPorVisita({ organizationId: ORG, conversationId: c.conversationId })).toEqual({ movido: false });
  });

  it("sin pedir visita, o con la visita de hace días, no se mueve", async () => {
    const sin = await cliente("nuevo", [{ text: "¿tiene garaje?" }]);
    const vieja = await cliente("nuevo", [{ text: "quiero visitar", horas: 30 }, { text: "gracias" }]);
    for (const c of [sin, vieja]) {
      expect((await m.visita.moverEtapaPorVisita({ organizationId: ORG, conversationId: c.conversationId })).movido).toBe(false);
      expect(await etapaDe(c.leadId)).toBe("nuevo");
    }
  });

  it("no retrocede, no toca un lead ganado ni una conversación de prueba", async () => {
    const agendada = await cliente("vag", [{ text: "quiero visitar otra casa" }]);
    const ganado = await cliente("res", [{ text: "quiero visitar" }]);
    const prueba = await cliente("nuevo", [{ text: "quiero visitar" }], true);
    expect(await m.visita.moverEtapaPorVisita({ organizationId: ORG, conversationId: agendada.conversationId })).toEqual({ movido: false });
    expect(await m.visita.moverEtapaPorVisita({ organizationId: ORG, conversationId: ganado.conversationId })).toEqual({ movido: false });
    expect(await m.visita.moverEtapaPorVisita({ organizationId: ORG, conversationId: prueba.conversationId })).toEqual({ movido: false });
    expect(await etapaDe(agendada.leadId)).toBe("vag");
    expect(await etapaDe(ganado.leadId)).toBe("res");
    expect(await etapaDe(prueba.leadId)).toBe("nuevo");
  });

  it("el traspaso del agente lo mueve solo (applyHandoff)", async () => {
    const c = await cliente("calif", [{ text: "¿Puedo ir a ver la casa modelo mañana?" }]);
    await m.pipeline.applyHandoff(c.conversationId, ORG, "cliente");
    const fin = Date.now() + 5000;
    while (Date.now() < fin && (await etapaDe(c.leadId)) !== "vpc") await new Promise((r) => setTimeout(r, 100));
    expect(await etapaDe(c.leadId)).toBe("vpc");
  });
});

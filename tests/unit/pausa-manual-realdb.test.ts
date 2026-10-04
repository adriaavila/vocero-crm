import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Fork — la pausa por respuesta manual vence, contra Postgres DE VERDAD
 * (opcional: se salta sin `REALDB_TEST_DATABASE_URL`, igual que
 * data-spine-realdb.test.ts):
 *
 *   REALDB_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:PUERTO/db \
 *     pnpm exec vitest run tests/unit/pausa-manual-realdb.test.ts
 *
 * Lo que un mock no prueba: las guardas atómicas de los UPDATE (solo pausa
 * si la IA estaba encendida; el reloj solo avanza; reanudar no pisa un
 * traspaso ni una reactivación), y que la ingesta de un entrante real reanuda
 * antes de pedir el turno.
 */

const REALDB_URL = process.env.REALDB_TEST_DATABASE_URL;
const describeReal = REALDB_URL ? describe : describe.skip;

const hoisted = vi.hoisted(() => ({ maybeRunAgentTurn: vi.fn(async () => {}) }));
vi.mock("@/server/ai/trigger", () => ({ maybeRunAgentTurn: hoisted.maybeRunAgentTurn }));

const SFX = Date.now().toString(36);
const ORG = `org_pausa_${SFX}`;
const ORG_NUNCA = `org_pausaN_${SFX}`;
const H = 3_600_000;
const ago = (hours: number, from = Date.now()) => new Date(from - hours * H);

type Mod = {
  db: ReturnType<typeof import("@/lib/db").getDb>;
  schema: typeof import("@/lib/db").schema;
  eq: typeof import("drizzle-orm").eq;
  ids: typeof import("@/lib/db/ids");
  pausa: typeof import("@/server/agencia/pausa-manual");
  ingest: typeof import("@/server/inbox/ingest");
  queries: typeof import("@/server/inbox/queries");
  iaInicial: typeof import("@/server/agencia/ia-inicial");
};
let m: Mod;
let seq = 0;

async function seedConversation(
  org: string,
  over: Partial<typeof import("@/lib/db").schema.conversation.$inferInsert> = {}
) {
  const tag = String(100 + seq++);
  const identity = `58412${SFX.replace(/\D/g, "").padStart(3, "0").slice(-3)}${tag}`;
  const contactId = m.ids.newId("contact");
  const id = m.ids.newId("conversation");
  await m.db.insert(m.schema.contact).values({
    id: contactId,
    organizationId: org,
    waIdentity: identity,
    phone: identity,
    name: `Contacto ${tag}`,
  });
  await m.db
    .insert(m.schema.conversation)
    .values({ id, organizationId: org, contactId, aiEnabled: true, ...over });
  return { id, identity };
}

async function row(id: string) {
  const rows = await m.db.select().from(m.schema.conversation).where(m.eq(m.schema.conversation.id, id));
  return rows[0]!;
}

describeReal("pausa manual que vence — Postgres real", { timeout: 30_000 }, () => {
  beforeAll(async () => {
    Object.assign(process.env, {
      DATABASE_URL: REALDB_URL,
      APP_BASE_URL: "http://localhost:3999",
      BETTER_AUTH_SECRET: "x".repeat(32),
      ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
      META_WEBHOOK_VERIFY_TOKEN: "pausa-verify",
      META_APP_SECRET: "pausa-secret",
      META_GRAPH_BASE_URL: "http://graph.invalid",
    });
    delete process.env.NEA_DISPATCH_URL;
    delete process.env.WA_MOCK_ENABLED;
    const { resetEnvCacheForTests } = await import("@/lib/env");
    resetEnvCacheForTests();
    const dbMod = await import("@/lib/db");
    m = {
      db: dbMod.getDb(),
      schema: dbMod.schema,
      eq: (await import("drizzle-orm")).eq,
      ids: await import("@/lib/db/ids"),
      pausa: await import("@/server/agencia/pausa-manual"),
      ingest: await import("@/server/inbox/ingest"),
      queries: await import("@/server/inbox/queries"),
      iaInicial: await import("@/server/agencia/ia-inicial"),
    };
    for (const org of [ORG, ORG_NUNCA]) {
      await m.db.insert(m.schema.organization).values({ id: org, name: org, slug: org });
      await m.db
        .insert(m.schema.pipelineStage)
        .values({ id: `stg_${org}`, organizationId: org, name: "Nuevo", position: 0, kind: "open" });
    }
    // ORG: agente encendido, fuera de horario L–V 9–18 (UTC para no depender
    // del día de la corrida: la regla del turno se prueba en el unit puro).
    await m.db.insert(m.schema.agentProfile).values({
      id: m.ids.newId("agentProfile"),
      organizationId: ORG,
      enabled: true,
      name: "Nea",
      businessTimezone: "UTC",
      responseMode: "all_day",
    });
    await m.db.insert(m.schema.agentProfile).values({
      id: m.ids.newId("agentProfile"),
      organizationId: ORG_NUNCA,
      enabled: true,
      name: "Nea",
      businessTimezone: "UTC",
      responseMode: "all_day",
      handoffResumeHours: 0,
    });
  }, 60_000);

  afterEach(() => {
    hoisted.maybeRunAgentTurn.mockClear();
  });

  afterAll(async () => {
    for (const org of [ORG, ORG_NUNCA]) {
      await m.db.delete(m.schema.organization).where(m.eq(m.schema.organization.id, org));
    }
  });

  it("pausa solo si la IA estaba encendida, y después solo adelanta el reloj", async () => {
    const { id } = await seedConversation(ORG);
    const t1 = ago(3);
    expect(await m.pausa.pausarPorRespuestaManual(id, t1)).toBe("paused");
    const c = await row(id);
    expect(c.aiEnabled).toBe(false);
    expect(c.handoffReason).toBe("manual_reply");
    expect(c.handoffAt?.getTime()).toBe(t1.getTime());

    // Segunda respuesta manual, más nueva: el reloj avanza.
    const t2 = ago(1);
    expect(await m.pausa.pausarPorRespuestaManual(id, t2)).toBe("extended");
    expect((await row(id)).handoffAt?.getTime()).toBe(t2.getTime());

    // Un echo viejo entregado tarde no lo atrasa.
    expect(await m.pausa.pausarPorRespuestaManual(id, ago(5))).toBe("extended");
    expect((await row(id)).handoffAt?.getTime()).toBe(t2.getTime());
  });

  it("un chat apagado a propósito no se marca; un traspaso del agente no se toca", async () => {
    const apagado = await seedConversation(ORG, { aiEnabled: false });
    expect(await m.pausa.pausarPorRespuestaManual(apagado.id, new Date())).toBe("none");
    const c = await row(apagado.id);
    expect(c.handoffAt).toBeNull();
    expect(c.aiEnabled).toBe(false);

    const traspasado = await seedConversation(ORG, {
      aiEnabled: false,
      handoffAt: ago(1),
      handoffReason: "cliente",
    });
    expect(await m.pausa.pausarPorRespuestaManual(traspasado.id, new Date())).toBe("none");
    expect((await row(traspasado.id)).handoffReason).toBe("cliente");
  });

  it("reanudarSiVencio: vuelve a las 12 h, no antes, y nunca con 0 horas", async () => {
    const fresca = await seedConversation(ORG, { aiEnabled: false, handoffAt: ago(11), handoffReason: "manual_reply" });
    expect(await m.pausa.reanudarSiVencio(await row(fresca.id))).toBe(false);
    expect((await row(fresca.id)).aiEnabled).toBe(false);

    const vencida = await seedConversation(ORG, { aiEnabled: false, handoffAt: ago(13), handoffReason: "manual_reply" });
    expect(await m.pausa.reanudarSiVencio(await row(vencida.id))).toBe(true);
    const c = await row(vencida.id);
    expect(c.aiEnabled).toBe(true);
    expect(c.handoffAt).toBeNull();
    expect(c.handoffReason).toBeNull();

    const nunca = await seedConversation(ORG_NUNCA, { aiEnabled: false, handoffAt: ago(200), handoffReason: "manual_reply" });
    expect(await m.pausa.reanudarSiVencio(await row(nunca.id))).toBe(false);
    expect((await row(nunca.id)).aiEnabled).toBe(false);
  });

  it("un entrante real reanuda la pausa vencida antes de pedir el turno", async () => {
    const { id, identity } = await seedConversation(ORG, {
      aiEnabled: false,
      handoffAt: ago(13),
      handoffReason: "manual_reply",
    });
    await m.ingest.ingestInboundMessage({
      organizationId: ORG,
      identity: { identity, phone: identity, waUserId: null, profileName: null },
      waMessageId: `wamid.pausa.${SFX}.${id}`,
      type: "text",
      text: "hola, ¿siguen ahí?",
      timestamp: String(Math.floor(Date.now() / 1000)),
    });
    const c = await row(id);
    expect(c.aiEnabled).toBe(true);
    expect(c.handoffReason).toBeNull();
    expect(hoisted.maybeRunAgentTurn).toHaveBeenCalledWith(id, ORG);

    // Un replay de un evento viejo no reanuda nada.
    const quieta = await seedConversation(ORG, { aiEnabled: false, handoffAt: ago(13), handoffReason: "manual_reply" });
    await m.ingest.ingestInboundMessage({
      organizationId: ORG,
      identity: { identity: quieta.identity, phone: quieta.identity, waUserId: null, profileName: null },
      waMessageId: `wamid.pausa.replay.${SFX}.${quieta.id}`,
      type: "text",
      text: "mensaje viejo",
      timestamp: String(Math.floor(Date.now() / 1000)),
      replay: true,
    });
    expect((await row(quieta.id)).aiEnabled).toBe(false);
  });

  it("una pausa renovada entre la lectura y el UPDATE no se pisa (carrera echo/entrante)", async () => {
    const { id } = await seedConversation(ORG, { aiEnabled: false, handoffAt: ago(13), handoffReason: "manual_reply" });
    const snapshot = await row(id); // lo que leyó la ingesta: vencida
    expect(await m.pausa.pausarPorRespuestaManual(id, ago(0.5))).toBe("extended"); // el dueño volvió a escribir
    expect(await m.pausa.reanudarSiVencio(snapshot)).toBe(false);
    const c = await row(id);
    expect(c.aiEnabled).toBe(false);
    expect(c.handoffReason).toBe("manual_reply");
  });

  it("una respuesta desde la bandeja adelanta el reloj, pero no pausa por sí sola", async () => {
    const pausada = await seedConversation(ORG, { aiEnabled: false, handoffAt: ago(5), handoffReason: "manual_reply" });
    const desdeLaBandeja = ago(1);
    expect(await m.pausa.extenderPausaManual(pausada.id, desdeLaBandeja)).toBe(true);
    expect((await row(pausada.id)).handoffAt?.getTime()).toBe(desdeLaBandeja.getTime());

    const activa = await seedConversation(ORG);
    expect(await m.pausa.extenderPausaManual(activa.id, new Date())).toBe(false);
    expect((await row(activa.id)).handoffAt).toBeNull();
  });

  it("una pausa anterior al deploy (sin reloj) no vence; el reloj arranca con la próxima respuesta", async () => {
    const legacy = await seedConversation(ORG, { aiEnabled: false, handoffAt: null, handoffReason: "manual_reply" });
    expect(await m.pausa.reanudarSiVencio({ ...(await row(legacy.id)), organizationId: ORG })).toBe(false);
    await m.pausa.barrerPausasVencidas();
    let c = await row(legacy.id);
    expect(c.aiEnabled).toBe(false);
    expect(c.handoffReason).toBe("manual_reply");

    const contesta = ago(13);
    expect(await m.pausa.pausarPorRespuestaManual(legacy.id, contesta)).toBe("extended");
    c = await row(legacy.id);
    expect(c.handoffAt?.getTime()).toBe(contesta.getTime());
    expect(await m.pausa.reanudarSiVencio({ ...c, organizationId: ORG })).toBe(true);
    expect((await row(legacy.id)).aiEnabled).toBe(true);
  });

  it("el interruptor reemplaza la pausa automática: apagar queda apagado, encender retoma ya", async () => {
    const apagar = await seedConversation(ORG, { aiEnabled: false, handoffAt: ago(13), handoffReason: "manual_reply" });
    await m.queries.updateConversation(ORG, apagar.id, { aiEnabled: false });
    let c = await row(apagar.id);
    expect(c.handoffReason).toBeNull();
    expect(c.aiEnabled).toBe(false);
    expect(await m.pausa.barrerPausasVencidas()).toBeGreaterThanOrEqual(0);
    expect((await row(apagar.id)).aiEnabled).toBe(false); // ya no "vence"

    const encender = await seedConversation(ORG, { aiEnabled: false, handoffAt: ago(1), handoffReason: "manual_reply" });
    await m.queries.updateConversation(ORG, encender.id, { aiEnabled: true });
    c = await row(encender.id);
    expect(c.aiEnabled).toBe(true);
    expect(c.handoffAt).toBeNull();

    // Un traspaso del agente no lo toca el interruptor.
    const traspaso = await seedConversation(ORG, { aiEnabled: false, handoffAt: ago(1), handoffReason: "cliente" });
    await m.queries.updateConversation(ORG, traspaso.id, { aiEnabled: true });
    expect((await row(traspaso.id)).handoffReason).toBe("cliente");
  });

  it("al activar el agente, lo que el dueño atendió hace poco pasa a pausa manual; el resto se enciende", async () => {
    const reciente = await seedConversation(ORG, { aiEnabled: false });
    const vieja = await seedConversation(ORG, { aiEnabled: false });
    const nunca = await seedConversation(ORG, { aiEnabled: false });
    const manual = async (conversationId: string, at: Date) =>
      m.db.insert(m.schema.message).values({
        id: m.ids.newId("message"),
        organizationId: ORG,
        conversationId,
        direction: "out",
        type: "text",
        text: "te contesto yo",
        status: "sent",
        origin: "manual",
        waTimestamp: at,
        createdAt: at,
      });
    const hace2h = ago(2);
    await manual(reciente.id, hace2h);
    await manual(vieja.id, ago(30));
    await m.iaInicial.encenderConversacionesEnEspera(ORG);
    const r = await row(reciente.id);
    expect(r.aiEnabled).toBe(false);
    expect(r.handoffReason).toBe("manual_reply");
    expect(r.handoffAt?.getTime()).toBe(hace2h.getTime());
    expect((await row(vieja.id)).aiEnabled).toBe(true);
    expect((await row(nunca.id)).aiEnabled).toBe(true);
  });

  it("el barrido reanuda solo las pausas manuales vencidas", async () => {
    const vencida = await seedConversation(ORG, { aiEnabled: false, handoffAt: ago(13), handoffReason: "manual_reply" });
    const fresca = await seedConversation(ORG, { aiEnabled: false, handoffAt: ago(2), handoffReason: "manual_reply" });
    const traspasada = await seedConversation(ORG, { aiEnabled: false, handoffAt: ago(100), handoffReason: "modelo" });
    const nunca = await seedConversation(ORG_NUNCA, { aiEnabled: false, handoffAt: ago(100), handoffReason: "manual_reply" });
    const antes = await m.pausa.barrerPausasVencidas();
    expect(antes).toBeGreaterThanOrEqual(1);
    expect((await row(vencida.id)).aiEnabled).toBe(true);
    expect((await row(fresca.id)).aiEnabled).toBe(false);
    expect((await row(traspasada.id)).handoffReason).toBe("modelo");
    expect((await row(nunca.id)).aiEnabled).toBe(false);
  });
});

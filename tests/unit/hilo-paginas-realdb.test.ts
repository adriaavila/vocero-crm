import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * El hilo por páginas contra Postgres DE VERDAD (se salta sin
 * `REALDB_TEST_DATABASE_URL`): la última página primero, las viejas por cursor,
 * y ningún mensaje perdido aunque varios compartan instante.
 */

const REALDB_URL = process.env.REALDB_TEST_DATABASE_URL;
const describeReal = REALDB_URL ? describe : describe.skip;

const SFX = Date.now().toString(36);
const ORG = `org_hilo_${SFX}`;

type Mod = {
  db: ReturnType<typeof import("@/lib/db").getDb>;
  schema: typeof import("@/lib/db").schema;
  eq: typeof import("drizzle-orm").eq;
  ids: typeof import("@/lib/db/ids");
  q: typeof import("@/server/inbox/queries");
};
let m: Mod;

describeReal("hilo por páginas — Postgres real", { timeout: 30_000 }, () => {
  beforeAll(async () => {
    Object.assign(process.env, {
      DATABASE_URL: REALDB_URL,
      APP_BASE_URL: "http://localhost:3999",
      BETTER_AUTH_SECRET: "x".repeat(32),
      ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
      META_WEBHOOK_VERIFY_TOKEN: "hilo-verify",
      META_APP_SECRET: "hilo-secret",
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
      q: await import("@/server/inbox/queries"),
    };
    await m.db.insert(m.schema.organization).values({ id: ORG, name: ORG, slug: ORG });
  }, 60_000);

  afterAll(async () => {
    await m.db.delete(m.schema.organization).where(m.eq(m.schema.organization.id, ORG));
  });

  it("recorre 250 mensajes en páginas sin perder ni repetir ninguno", async () => {
    const contactId = m.ids.newId("contact");
    const conversationId = m.ids.newId("conversation");
    await m.db.insert(m.schema.contact).values({ id: contactId, organizationId: ORG, name: "Hilo", waIdentity: `58412${SFX.replace(/\D/g, "").slice(-6)}` });
    await m.db.insert(m.schema.conversation).values({ id: conversationId, organizationId: ORG, contactId });
    const base = Date.now() - 1_000_000;
    // De a cinco por instante: como un historial importado.
    const rows = Array.from({ length: 250 }, (_, i) => ({
      id: m.ids.newId("message"),
      organizationId: ORG,
      conversationId,
      direction: (i % 2 ? "out" : "in") as "in" | "out",
      origin: "operator" as const,
      text: `m${i}`,
      createdAt: new Date(base + Math.floor(i / 5) * 1000),
    }));
    await m.db.insert(m.schema.message).values(rows);

    const vistos: string[] = [];
    let page = await m.q.listMessages(ORG, conversationId);
    expect(page.rows).toHaveLength(m.q.MESSAGES_PAGE);
    expect(page.hasMore).toBe(true);
    // La última página es la más nueva (los cinco del último instante).
    expect(page.rows.at(-1)?.message.createdAt.getTime()).toBe(rows.at(-1)!.createdAt.getTime());
    vistos.unshift(...page.rows.map((r) => r.message.id));
    while (page.hasMore) {
      page = await m.q.listMessages(ORG, conversationId, { beforeId: vistos[0] });
      vistos.unshift(...page.rows.map((r) => r.message.id));
    }
    expect(vistos).toHaveLength(250);
    expect(new Set(vistos).size).toBe(250);

    // Otra organización no pagina con un cursor ajeno.
    const ajeno = await m.q.listMessages("org_otra", conversationId, { beforeId: vistos[100] });
    expect(ajeno.rows).toHaveLength(0);
  });
});

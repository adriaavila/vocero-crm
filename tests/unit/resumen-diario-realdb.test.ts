import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Fork — resumen diario contra Postgres DE VERDAD (se salta sin
 * `REALDB_TEST_DATABASE_URL`). El envío de push se intercepta.
 */

const REALDB_URL = process.env.REALDB_TEST_DATABASE_URL;
const describeReal = REALDB_URL ? describe : describe.skip;

const hoisted = vi.hoisted(() => ({ avisos: [] as { org: string; title: string; body: string; tag: string }[] }));
vi.mock("@/server/agencia/avisos", () => ({
  enviarAviso: async (org: string, a: { title: string; body: string; tag: string }) => {
    hoisted.avisos.push({ org, ...a });
    return 1;
  },
}));

const SFX = Date.now().toString(36);
const ORG = `org_res_${SFX}`;
const ORG_QUIETO = `org_resq_${SFX}`;
// 19:30 en Ciudad de México (UTC-6).
const SIETE = new Date("2026-10-08T01:30:00Z");
const MEDIODIA = new Date("2026-10-07T18:00:00Z");
const min = (m: number) => new Date(SIETE.getTime() - m * 60_000);

type Mod = {
  db: ReturnType<typeof import("@/lib/db").getDb>;
  schema: typeof import("@/lib/db").schema;
  eq: typeof import("drizzle-orm").eq;
  ids: typeof import("@/lib/db/ids");
  res: typeof import("@/server/agencia/resumen-diario");
};
let m: Mod;

describeReal("resumen diario — Postgres real", { timeout: 30_000 }, () => {
  beforeAll(async () => {
    Object.assign(process.env, {
      DATABASE_URL: REALDB_URL,
      APP_BASE_URL: "http://localhost:3999",
      BETTER_AUTH_SECRET: "x".repeat(32),
      ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
      META_WEBHOOK_VERIFY_TOKEN: "res-verify",
      META_APP_SECRET: "res-secret",
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
      res: await import("@/server/agencia/resumen-diario"),
    };
    for (const org of [ORG, ORG_QUIETO]) {
      await m.db.insert(m.schema.organization).values({ id: org, name: org, slug: org });
      await m.db.insert(m.schema.agentProfile).values({
        id: m.ids.newId("agentProfile"),
        organizationId: org,
        enabled: true,
        name: "Asistente",
        businessTimezone: "America/Mexico_City",
      });
    }
    // Dos clientes hoy; el agente contesta a los dos y agenda una cita.
    for (const [i, name] of ["Ana", "Beto"].entries()) {
      const contactId = m.ids.newId("contact");
      const conversationId = m.ids.newId("conversation");
      await m.db.insert(m.schema.contact).values({
        id: contactId,
        organizationId: ORG,
        waIdentity: `5255${SFX.replace(/\D/g, "").slice(-5)}${i}`,
        name,
      });
      await m.db.insert(m.schema.conversation).values({
        id: conversationId,
        organizationId: ORG,
        contactId,
        lastInboundAt: min(60),
        lastMessageAt: min(59),
      });
      for (const [direction, origin, at] of [
        ["in", "operator", min(60)],
        ["out", "ai", min(59)],
      ] as const) {
        await m.db.insert(m.schema.message).values({
          id: m.ids.newId("message"),
          organizationId: ORG,
          conversationId,
          direction,
          origin,
          text: "hola",
          createdAt: at,
        });
      }
      if (i === 0) {
        await m.db.insert(m.schema.booking).values({
          id: m.ids.newId("booking"),
          organizationId: ORG,
          contactId,
          conversationId,
          source: "ai",
          scheduledAt: new Date(SIETE.getTime() + 2 * 86_400_000),
          durationMinutes: 30,
          createdAt: min(58),
        });
      }
    }
  }, 60_000);

  afterAll(async () => {
    for (const org of [ORG, ORG_QUIETO]) {
      await m.db.delete(m.schema.organization).where(m.eq(m.schema.organization.id, org));
    }
  });

  it("cuenta lo de hoy en la zona del negocio", async () => {
    expect(await m.res.resumenDelDia(ORG, SIETE)).toEqual({ clientes: 2, respuestas: 2, citas: 1, teEsperan: 0 });
  });

  it("a las 19:00 manda una vez; a otra hora o repetido, no", async () => {
    expect(await m.res.resumirNegocio(ORG, MEDIODIA)).toBe(0);
    expect(await m.res.resumirNegocio(ORG, SIETE)).toBe(1);
    expect(await m.res.resumirNegocio(ORG, new Date(SIETE.getTime() + 10 * 60_000))).toBe(0);
    const mios = hoisted.avisos.filter((a) => a.org === ORG);
    expect(mios).toHaveLength(1);
    expect(mios[0]).toMatchObject({
      title: "Hoy te escribieron 2 clientes",
      body: "Tu agente contestó 2 mensajes y agendó 1 cita. Nadie te espera.",
      tag: "resumen-2026-10-07",
    });
  });

  it("un negocio sin clientes hoy no recibe nada", async () => {
    expect(await m.res.resumirNegocio(ORG_QUIETO, SIETE)).toBe(0);
    expect(hoisted.avisos.filter((a) => a.org === ORG_QUIETO)).toHaveLength(0);
  });
});

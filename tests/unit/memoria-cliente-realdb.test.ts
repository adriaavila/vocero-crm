import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Fork — memoria del cliente contra Postgres DE VERDAD (se salta sin
 * `REALDB_TEST_DATABASE_URL`).
 */

const REALDB_URL = process.env.REALDB_TEST_DATABASE_URL;
const describeReal = REALDB_URL ? describe : describe.skip;

const SFX = Date.now().toString(36);
const ORG = `org_mem_${SFX}`;
const H = 3_600_000;
const now = new Date();
const at = (hours: number) => new Date(now.getTime() + hours * H);

type Mod = {
  db: ReturnType<typeof import("@/lib/db").getDb>;
  schema: typeof import("@/lib/db").schema;
  eq: typeof import("drizzle-orm").eq;
  ids: typeof import("@/lib/db/ids");
  mem: typeof import("@/server/agencia/memoria-cliente");
};
let m: Mod;

describeReal("memoria del cliente — Postgres real", { timeout: 30_000 }, () => {
  beforeAll(async () => {
    Object.assign(process.env, {
      DATABASE_URL: REALDB_URL,
      APP_BASE_URL: "http://localhost:3999",
      BETTER_AUTH_SECRET: "x".repeat(32),
      ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
      META_WEBHOOK_VERIFY_TOKEN: "mem-verify",
      META_APP_SECRET: "mem-secret",
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
      mem: await import("@/server/agencia/memoria-cliente"),
    };
    await m.db.insert(m.schema.organization).values({ id: ORG, name: ORG, slug: ORG });
  }, 60_000);

  afterAll(async () => {
    await m.db.delete(m.schema.organization).where(m.eq(m.schema.organization.id, ORG));
  });

  it("junta notas, ficha, la próxima cita real y las visitas; ignora lo de prueba y lo cancelado", async () => {
    const contactId = m.ids.newId("contact");
    const conversationId = m.ids.newId("conversation");
    await m.db.insert(m.schema.contact).values({
      id: contactId,
      organizationId: ORG,
      waIdentity: `58414${SFX.replace(/\D/g, "").slice(-6)}`,
      name: "Marta",
      notes: "[IA] Pregunta por su hija",
      ficha: { tratamiento: "limpieza" },
    });
    await m.db.insert(m.schema.conversation).values({
      id: conversationId,
      organizationId: ORG,
      contactId,
      lastInboundAt: now,
      lastMessageAt: now,
    });
    await m.db.insert(m.schema.message).values({
      id: m.ids.newId("message"),
      organizationId: ORG,
      conversationId,
      direction: "in",
      origin: "operator",
      text: "hola",
      createdAt: at(-24 * 20),
    });
    const cita = (scheduledAt: Date, status: "agendada" | "realizada" | "cancelada", isTest = false) =>
      m.db.insert(m.schema.booking).values({
        id: m.ids.newId("booking"),
        organizationId: ORG,
        contactId,
        conversationId,
        scheduledAt,
        durationMinutes: 30,
        status,
        isTest,
      });
    await cita(at(48), "agendada");
    await cita(at(24), "cancelada");
    await cita(at(5), "agendada", true);
    await cita(at(-24 * 10), "realizada");

    const mem = (await m.mem.cargarMemoriaCliente({ organizationId: ORG, contactId, conversationId, now }))!;
    expect(mem.name).toBe("Marta");
    expect(mem.notes).toContain("hija");
    expect(mem.ficha).toEqual({ tratamiento: "limpieza" });
    expect(mem.proximas.map((d) => Math.round(d.getTime() / 1000))).toEqual([Math.round(at(48).getTime() / 1000)]);
    expect(mem.realizadas).toBe(1);
    expect(mem.clienteDesde).not.toBeNull();

    const texto = await m.mem.memoriaParaPrompt({ organizationId: ORG, contactId, conversationId, timezone: "UTC" });
    expect(texto).toContain("Tiene una cita agendada");
  });

  it("de otra organización no lee nada", async () => {
    const r = await m.mem.cargarMemoriaCliente({
      organizationId: `${ORG}_otra`,
      contactId: "ct_inexistente",
      conversationId: "cv_inexistente",
    });
    expect(r).toBeNull();
  });
});

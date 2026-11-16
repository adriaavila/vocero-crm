import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Fork — el agente manda la tarjeta de la casa que nombra, contra Postgres DE
 * VERDAD (se salta sin `REALDB_TEST_DATABASE_URL`). El envío a Meta se
 * simula: lo que se prueba es qué tarjeta sale, a qué chat y cuándo no.
 *
 *   REALDB_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:PUERTO/db \
 *     pnpm exec vitest run tests/unit/sala-agente-realdb.test.ts
 */

const REALDB_URL = process.env.REALDB_TEST_DATABASE_URL;
const describeReal = REALDB_URL ? describe : describe.skip;

const enviados = vi.hoisted(() => [] as { conversationId: string; texto: string; interactive: Record<string, unknown> }[]);
vi.mock("@/server/inbox/send", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/inbox/send")>();
  return {
    ...actual,
    sendInteractive: vi.fn(async (input: { conversationId: string; organizationId: string; texto: string; interactive: Record<string, unknown> }) => {
      enviados.push(input);
      const { getDb, schema } = await import("@/lib/db");
      const { newId } = await import("@/lib/db/ids");
      const id = newId("message");
      await getDb().insert(schema.message).values({
        id,
        organizationId: input.organizationId,
        conversationId: input.conversationId,
        direction: "out",
        type: "interactive",
        origin: "ai",
        aiGenerated: true,
        status: "sent",
        text: input.texto,
      });
      return { messageId: id };
    }),
  };
});

const SFX = Date.now().toString(36);
const ORG = `org_salag_${SFX}`;
let seq = 0;

type Mod = {
  db: ReturnType<typeof import("@/lib/db").getDb>;
  schema: typeof import("@/lib/db").schema;
  eq: typeof import("drizzle-orm").eq;
  ids: typeof import("@/lib/db/ids");
  agente: typeof import("@/server/agencia/sala-agente");
};
let m: Mod;

async function conv(over: Partial<typeof import("@/lib/db").schema.conversation.$inferInsert> = {}) {
  const tag = String(100 + seq++);
  const contactId = m.ids.newId("contact");
  const id = m.ids.newId("conversation");
  await m.db.insert(m.schema.contact).values({
    id: contactId,
    organizationId: ORG,
    waIdentity: `59172${SFX.replace(/\D/g, "").padStart(3, "0").slice(-3)}${tag}`,
    name: `Comprador ${tag}`,
  });
  await m.db.insert(m.schema.conversation).values({ id, organizationId: ORG, contactId, aiEnabled: true, ...over });
  return { id, contactId };
}

async function casa(titulo: string, precio: number, status: "disponible" | "cerrada" = "disponible") {
  const id = m.ids.newId("property");
  await m.db.insert(m.schema.property).values({
    id,
    organizationId: ORG,
    operation: "venta",
    kind: "casa",
    title: titulo,
    price: String(precio),
    currency: "USD",
    bedrooms: 3,
    bathrooms: "3",
    builtArea: "148",
    status,
  });
  return id;
}

describeReal("el agente manda la tarjeta de la casa — Postgres real", { timeout: 30_000 }, () => {
  let v2: string;

  beforeAll(async () => {
    Object.assign(process.env, {
      DATABASE_URL: REALDB_URL,
      SALA_VENTA: "on",
      APP_BASE_URL: "https://crm.ejemplo.test",
      BETTER_AUTH_SECRET: "x".repeat(32),
      ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
      META_WEBHOOK_VERIFY_TOKEN: "salag-verify",
      META_APP_SECRET: "salag-secret",
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
      agente: await import("@/server/agencia/sala-agente"),
    };
    await m.db.insert(m.schema.organization).values({ id: ORG, name: "SAMER", slug: ORG });
    const { setOrgVertical } = await import("@/server/agencia/vertical");
    await setOrgVertical(ORG, "inmobiliario");
    v2 = await casa("Vivienda 2", 120000);
    await casa("Vivienda 5", 135000);
    await casa("Vivienda 6", 130000);
    await casa("Vivienda 1", 110000, "cerrada");
  }, 60_000);

  beforeEach(() => {
    enviados.length = 0;
  });

  afterAll(async () => {
    await m.db.delete(m.schema.organization).where(m.eq(m.schema.organization.id, ORG));
  });

  const responder = (conversationId: string, texto: string) =>
    m.agente.tarjetasTrasRespuesta({ organizationId: ORG, conversationId, texto });

  it("nombra una casa → sale su tarjeta con «Quiero visitar», y la casa entra a la sala", async () => {
    const c = await conv();
    expect(await responder(c.id, "La Vivienda 2 cuesta $us 120.000 y se entrega en noviembre 🙂")).toBe(1);
    expect(enviados).toHaveLength(1);
    expect(enviados[0]!.texto.split("\n")[0]).toBe("Vivienda 2");
    expect(JSON.stringify(enviados[0]!.interactive)).toContain(`sala:visita:${v2}`);
    const [sala] = await m.db.select().from(m.schema.salaVenta).where(m.eq(m.schema.salaVenta.contactId, c.contactId));
    expect(sala?.propertyIds).toEqual([v2]);
  });

  it("no la repite en el mismo chat", async () => {
    const c = await conv();
    expect(await responder(c.id, "La Vivienda 2 es de 148 m²")).toBe(1);
    expect(await responder(c.id, "Como te decía, la Vivienda 2 tiene patio")).toBe(0);
    expect(enviados).toHaveLength(1);
  });

  it("un menú de tres casas no manda tarjetas; una casa cerrada tampoco", async () => {
    const c = await conv();
    expect(await responder(c.id, "Tenemos Vivienda 2, Vivienda 5 y Vivienda 6")).toBe(0);
    expect(await responder(c.id, "La Vivienda 1 ya se vendió")).toBe(0);
    expect(enviados).toHaveLength(0);
  });

  it("no en el Laboratorio, ni en un chat que tomó una persona", async () => {
    const prueba = await conv({ isTest: true });
    const tomada = await conv({ handoffAt: new Date(), handoffReason: "cliente" });
    expect(await responder(prueba.id, "La Vivienda 5 te va a gustar")).toBe(0);
    expect(await responder(tomada.id, "La Vivienda 5 te va a gustar")).toBe(0);
    expect(enviados).toHaveLength(0);
  });

  it("apagado sin SALA_VENTA: nada cambia", async () => {
    const c = await conv();
    process.env.SALA_VENTA = "";
    try {
      expect(await responder(c.id, "La Vivienda 6 está lista")).toBe(0);
    } finally {
      process.env.SALA_VENTA = "on";
    }
  });
});

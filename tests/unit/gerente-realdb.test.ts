import { writeFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Fork — el gerente de ventas por WhatsApp contra Postgres DE VERDAD (se salta
 * sin `REALDB_TEST_DATABASE_URL`). Entra por `ingestInboundMessage`, el mismo
 * camino que un mensaje real al número de Rei; el envío a Meta se intercepta.
 *
 * Lo que prueba: el código conecta el WhatsApp de la persona correcta, cada
 * quien ve SOLO su negocio, un desconocido no ve nada, y el lunes sale una vez.
 * Con `GERENTE_DUMP=<archivo>` escribe la conversación (para las capturas).
 */

const REALDB_URL = process.env.REALDB_TEST_DATABASE_URL;
const describeReal = REALDB_URL ? describe : describe.skip;

const enviados = vi.hoisted(() => [] as { conversationId: string; text: string; botones: boolean; plantilla?: string[] }[]);
vi.mock("@/server/inbox/send", () => ({
  sendText: async (i: { conversationId: string; text: string }) => {
    enviados.push({ conversationId: i.conversationId, text: i.text, botones: false });
    return { messageId: "m" };
  },
  sendButtons: async (i: { conversationId: string; body: string }) => {
    enviados.push({ conversationId: i.conversationId, text: i.body, botones: true });
    return { messageId: "m" };
  },
}));
vi.mock("@/server/whatsapp/templates", () => ({
  sendTemplate: async (i: { conversationId: string; variables: string[] }) => {
    enviados.push({ conversationId: i.conversationId, text: "[plantilla]", botones: false, plantilla: i.variables });
    return { messageId: "m" };
  },
}));
vi.mock("@/server/ai/trigger", () => ({ maybeRunAgentTurn: async () => {} }));

const SFX = Date.now().toString(36);
const REI = `org_grei_${SFX}`;
const SAMER = `org_gsam_${SFX}`;
const OTRA = `org_gotr_${SFX}`;
const SERGIO = `user_gs_${SFX}`;
const ANA = `user_ga_${SFX}`;
const TEL_SERGIO = `5917${SFX.slice(-7)}1`.slice(0, 12);
const TEL_ANA = `5917${SFX.slice(-7)}2`.slice(0, 12);
const TEL_EXTRANO = `5917${SFX.slice(-7)}3`.slice(0, 12);

type Mod = {
  db: ReturnType<typeof import("@/lib/db").getDb>;
  schema: typeof import("@/lib/db").schema;
  eq: typeof import("drizzle-orm").eq;
  ingest: typeof import("@/server/inbox/ingest");
  g: typeof import("@/server/agencia/gerente");
};
let m: Mod;
let n = 0;
const dialogo: { de: "dueno" | "rei"; texto: string; botones?: boolean }[] = [];

async function escribe(tel: string, texto: string, at: Date = new Date()) {
  const antes = enviados.length;
  dialogo.push({ de: "dueno", texto });
  await m.ingest.ingestInboundMessage({
    organizationId: REI,
    identity: { identity: tel, phone: tel, waUserId: null, profileName: "Dueño" },
    waMessageId: `wamid.g.${SFX}.${++n}`,
    type: "text",
    text: texto,
    timestamp: String(Math.floor(at.getTime() / 1000)),
  });
  const nuevos = enviados.slice(antes);
  for (const e of nuevos) dialogo.push({ de: "rei", texto: e.text, botones: e.botones });
  return nuevos;
}

describeReal("Gerente de ventas por WhatsApp — Postgres real", { timeout: 60_000 }, () => {
  beforeAll(async () => {
    Object.assign(process.env, {
      DATABASE_URL: REALDB_URL,
      APP_BASE_URL: "http://localhost:3999",
      BETTER_AUTH_SECRET: "x".repeat(32),
      ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
      META_WEBHOOK_VERIFY_TOKEN: "gerente-verify-token",
      GERENTE_NEGOCIO: `rei-${SFX}`,
      GERENTE_WHATSAPP: "+591 70000000",
    });
    const { resetEnvCacheForTests } = await import("@/lib/env");
    resetEnvCacheForTests();
    const dbMod = await import("@/lib/db");
    const orm = await import("drizzle-orm");
    m = {
      db: dbMod.getDb(),
      schema: dbMod.schema,
      eq: orm.eq,
      ingest: await import("@/server/inbox/ingest"),
      g: await import("@/server/agencia/gerente"),
    };
    m.g.resetGerenteCache();
    await m.db.insert(m.schema.organization).values([
      { id: REI, name: "Rei", slug: `rei-${SFX}` },
      { id: SAMER, name: "SAMER", slug: `samer-${SFX}` },
      { id: OTRA, name: "Otra Constructora", slug: `otra-${SFX}` },
    ]);
    await m.db.insert(m.schema.user).values([
      { id: SERGIO, name: "Sergio Aguilar", email: `sergio-${SFX}@x.test` },
      { id: ANA, name: "Ana Ríos", email: `ana-${SFX}@x.test` },
    ]);
    await m.db.insert(m.schema.property).values([
      { id: `prop_g_${SFX}_1`, organizationId: SAMER, operation: "venta", kind: "casa", title: "Casa V2", price: "120000" },
      { id: `prop_g_${SFX}_2`, organizationId: OTRA, operation: "venta", kind: "departamento", title: "Depto Secreto", price: "90000" },
    ]);
  });

  beforeEach(() => {
    enviados.length = 0;
  });

  afterAll(async () => {
    if (!m) return;
    if (process.env.GERENTE_DUMP) writeFileSync(process.env.GERENTE_DUMP, JSON.stringify(dialogo, null, 2));
    for (const org of [REI, SAMER, OTRA]) await m.db.delete(m.schema.organization).where(m.eq(m.schema.organization.id, org));
    for (const u of [SERGIO, ANA]) await m.db.delete(m.schema.user).where(m.eq(m.schema.user.id, u));
  });

  it("solo el negocio de Rei es el número del gerente", async () => {
    expect(await m.g.esNumeroDelGerente(REI)).toBe(true);
    expect(await m.g.esNumeroDelGerente(SAMER)).toBe(false);
    // Rei no se ofrece a sí mismo la tarjeta.
    expect((await m.g.estadoGerente(REI, SERGIO)).disponible).toBe(false);
  });

  it("un desconocido recibe cómo conectarse, y nada de ningún negocio", async () => {
    const r = await escribe(TEL_EXTRANO, "hola, cómo van las ventas de SAMER?");
    expect(r).toHaveLength(1);
    expect(r[0]!.text).toContain("Conectar mi WhatsApp");
    expect(r[0]!.text).not.toContain("Casa V2");
  });

  it("el código conecta el WhatsApp de quien lo pidió", async () => {
    const e = await m.g.codigoParaConectar(SAMER, SERGIO);
    expect(e.disponible && e.codigo).toMatch(/^REI \d{6}$/);
    expect(e.disponible && e.numero).toBe("59170000000");
    const codigo = e.disponible ? e.codigo! : "";
    const r = await escribe(TEL_SERGIO, codigo);
    expect(r[0]!.text).toContain("Listo, Sergio. Soy tu gerente de ventas de *SAMER*");
    expect(r[0]!.botones).toBe(true);
    const ahora = await m.g.estadoGerente(SAMER, SERGIO);
    expect(ahora.disponible && ahora.conectado).toBe(true);
    // El código se gasta: mandarlo otra vez ya no conecta nada.
    expect((await escribe(TEL_EXTRANO, codigo))[0]!.text).toContain("no existe o ya venció");
  });

  it("contesta con las cifras de SU negocio", async () => {
    const reporte = await escribe(TEL_SERGIO, "¿Cómo vamos esta semana?");
    expect(reporte.map((x) => x.text).join("\n")).toContain("*SAMER · ventas*");
    const casas = await escribe(TEL_SERGIO, "¿qué casas no se mueven?");
    expect(casas[0]!.text).toContain("Casa V2");
    expect(casas[0]!.text).not.toContain("Depto Secreto");
    const llamar = await escribe(TEL_SERGIO, "A quién llamo");
    expect(llamar[0]!.text).toMatch(/nadie te espera|Llámalos hoy|Te esperan/);
    const mejorar = await escribe(TEL_SERGIO, "Qué mejoro");
    expect(mejorar[0]!.text.length).toBeGreaterThan(10);
  });

  it("otra persona de otro negocio ve el suyo, no el de SAMER", async () => {
    const e = await m.g.codigoParaConectar(OTRA, ANA);
    await escribe(TEL_ANA, e.disponible ? e.codigo! : "");
    const r = await escribe(TEL_ANA, "casas");
    expect(r[0]!.text).toContain("Depto Secreto");
    expect(r[0]!.text).not.toContain("Casa V2");
  });

  it("un código vencido no conecta", async () => {
    const e = await m.g.codigoParaConectar(OTRA, ANA, new Date(Date.now() - 31 * 60_000));
    const r = await escribe(TEL_EXTRANO, e.disponible ? e.codigo! : "");
    expect(r[0]!.text).toContain("no existe o ya venció");
  });

  it("el lunes a las 8 sale el reporte, una sola vez, y «pausar reporte» lo apaga", async () => {
    // Un lunes cualquiera: se prueba hora por hora para no depender de la zona del negocio.
    const lunes = new Date("2026-11-02T00:00:00Z");
    await escribe(TEL_SERGIO, "hola", new Date(lunes.getTime() + 2 * 3_600_000)); // ventana abierta
    enviados.length = 0;
    let total = 0;
    for (let h = 0; h < 36; h++) total += await m.g.barrerReportesSemanales(new Date(lunes.getTime() + h * 3_600_000 + 5 * 60_000));
    // Sergio con ventana abierta → reporte entero. Ana tiene la ventana cerrada y no hay plantilla: no sale.
    expect(total).toBe(1);
    expect(enviados.map((x) => x.text).join("\n")).toContain("*SAMER · ventas*");

    const p = await escribe(TEL_SERGIO, "pausar reporte");
    expect(p[0]!.text).toContain("no te mando más");
    const fila = await m.db.select().from(m.schema.gerenteDueno).where(m.eq(m.schema.gerenteDueno.userId, SERGIO));
    expect(fila[0]!.reporteSemanal).toBe(false);
    await escribe(TEL_SERGIO, "activar reporte");
  });
});

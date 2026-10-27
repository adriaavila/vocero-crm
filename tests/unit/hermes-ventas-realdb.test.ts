import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Fork — el reporte de ventas de Hermes contra Postgres DE VERDAD (se salta
 * sin `REALDB_TEST_DATABASE_URL`):
 *
 *   REALDB_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:PUERTO/db \
 *     pnpm exec vitest run tests/unit/hermes-ventas-realdb.test.ts
 *
 * Lo que la función pura no prueba: que cada cifra salga de las filas
 * correctas (casa mostrada, visita sin resultado, lo que el agente no supo,
 * Laboratorio fuera) y que el negocio se resuelva por su slug.
 */

const REALDB_URL = process.env.REALDB_TEST_DATABASE_URL;
const describeReal = REALDB_URL ? describe : describe.skip;

const SFX = Date.now().toString(36);
const ORG = `org_hv_${SFX}`;
const OTRA = `org_hvo_${SFX}`;
const NOW = new Date("2026-10-26T16:00:00Z");
const h = (n: number) => new Date(NOW.getTime() - n * 3_600_000);
const enH = (n: number) => new Date(NOW.getTime() + n * 3_600_000);

type Mod = {
  db: ReturnType<typeof import("@/lib/db").getDb>;
  schema: typeof import("@/lib/db").schema;
  eq: typeof import("drizzle-orm").eq;
  hv: typeof import("@/server/agencia/hermes-ventas");
};
let m: Mod;
let seq = 0;

async function propiedad(org: string, title: string, status: "disponible" | "apartada" | "cerrada" = "disponible") {
  const id = `prop_${SFX}_${++seq}`;
  await m.db.insert(m.schema.property).values({ id, organizationId: org, operation: "venta", kind: "casa", title, price: "120000", status });
  return id;
}

async function cliente(
  org: string,
  name: string,
  o: { test?: boolean; casa?: string; msgs?: { at: Date; text: string }[]; handoff?: { at: Date; reason: "cliente" | "modelo" } } = {},
) {
  const n = ++seq;
  const contactId = `ct_${SFX}_${n}`;
  const convId = `cv_${SFX}_${n}`;
  const msgs = o.msgs ?? [{ at: h(2), text: "hola" }];
  await m.db.insert(m.schema.contact).values({ id: contactId, organizationId: org, waIdentity: `5917${SFX}${n}`.slice(0, 20), name });
  await m.db.insert(m.schema.conversation).values({
    id: convId,
    organizationId: org,
    contactId,
    isTest: o.test ?? false,
    handoffAt: o.handoff?.at ?? null,
    handoffReason: o.handoff?.reason ?? null,
    lastInboundAt: msgs.at(-1)!.at,
    lastMessageAt: msgs.at(-1)!.at,
  });
  for (const [i, msg] of msgs.entries()) {
    await m.db.insert(m.schema.message).values({
      id: `msg_${SFX}_${n}_${i}`,
      organizationId: org,
      conversationId: convId,
      direction: "in",
      text: msg.text,
      status: "delivered",
      createdAt: msg.at,
      waTimestamp: msg.at,
    });
  }
  if (o.casa) {
    await m.db.insert(m.schema.conversationProperty).values({ conversationId: convId, organizationId: org, propertyId: o.casa, updatedAt: msgs.at(-1)!.at });
  }
  return { contactId, convId };
}

async function visita(
  org: string,
  contactId: string,
  casa: string,
  at: Date,
  o: { status?: "agendada" | "realizada" | "no_show" | "cancelada"; outcome?: "interesado" | "no_interesado" | "quiere_negociar"; test?: boolean } = {},
) {
  const id = `bk_${SFX}_${++seq}`;
  await m.db.insert(m.schema.booking).values({
    id,
    organizationId: org,
    contactId,
    scheduledAt: at,
    durationMinutes: 45,
    status: o.status ?? "agendada",
    isTest: o.test ?? false,
  });
  await m.db.insert(m.schema.bookingProperty).values({ bookingId: id, organizationId: org, propertyId: casa, outcome: o.outcome ?? null });
}

describeReal("Hermes · reporte de ventas — Postgres real", { timeout: 30_000 }, () => {
  beforeAll(async () => {
    Object.assign(process.env, {
      DATABASE_URL: REALDB_URL,
      APP_BASE_URL: "http://localhost:3999",
      BETTER_AUTH_SECRET: "x".repeat(32),
      ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
      META_WEBHOOK_VERIFY_TOKEN: "hermes-verify-token",
    });
    const { resetEnvCacheForTests } = await import("@/lib/env");
    resetEnvCacheForTests();
    const dbMod = await import("@/lib/db");
    const orm = await import("drizzle-orm");
    m = { db: dbMod.getDb(), schema: dbMod.schema, eq: orm.eq, hv: await import("@/server/agencia/hermes-ventas") };
    await m.db.insert(m.schema.organization).values({ id: ORG, name: "SAMER", slug: `samer-${SFX}` });
    await m.db.insert(m.schema.organization).values({ id: OTRA, name: "Otra", slug: `otra-${SFX}` });

    const v1 = await propiedad(ORG, "V1", "cerrada");
    const v2 = await propiedad(ORG, "V2");
    const v3 = await propiedad(ORG, "V3");
    await propiedad(ORG, "V4");
    const otraCasa = await propiedad(OTRA, "Ajena");

    const ana = await cliente(ORG, "Ana", { casa: v2 });
    const beto = await cliente(ORG, "Beto", { casa: v2 });
    const caro = await cliente(ORG, "Caro", {
      casa: v3,
      msgs: [
        { at: h(30), text: "hola" },
        { at: h(26), text: "¿Tienen estacionamiento para dos autos?" },
      ],
      handoff: { at: h(25), reason: "modelo" },
    });
    await cliente(ORG, "Dani", { handoff: { at: h(3), reason: "cliente" } });
    // Laboratorio: no cuenta para nada.
    const lab = await cliente(ORG, "Prueba", { test: true, casa: v3 });
    await visita(ORG, lab.contactId, v3, h(5), { test: true });
    // Otro negocio: tampoco.
    const ajeno = await cliente(OTRA, "Ajeno", { casa: otraCasa });
    await visita(OTRA, ajeno.contactId, otraCasa, h(5), { status: "realizada", outcome: "interesado" });

    await visita(ORG, ana.contactId, v2, h(48), { status: "realizada", outcome: "quiere_negociar" });
    await visita(ORG, beto.contactId, v2, h(20)); // pasó y nadie anotó
    await visita(ORG, caro.contactId, v3, enH(30)); // próxima
    await visita(ORG, caro.contactId, v1, h(60), { status: "cancelada" });

    await m.db.insert(m.schema.agentTestRun).values({ id: `run_${SFX}`, organizationId: ORG, status: "done", score: 17, finishedAt: h(70), startedAt: h(71) });
  });

  afterAll(async () => {
    if (!m) return;
    for (const org of [ORG, OTRA]) {
      // `booking_property.property_id` es RESTRICT: primero las visitas.
      await m.db.delete(m.schema.bookingProperty).where(m.eq(m.schema.bookingProperty.organizationId, org));
      await m.db.delete(m.schema.organization).where(m.eq(m.schema.organization.id, org));
    }
  });

  it("resuelve el negocio por slug o id, y nada más", async () => {
    expect(await m.hv.resolverNegocio(`samer-${SFX}`)).toBe(ORG);
    expect(await m.hv.resolverNegocio(ORG)).toBe(ORG);
    expect(await m.hv.resolverNegocio("no-existe")).toBeNull();
  });

  it("cuenta cada casa, visita y pregunta desde sus filas", async () => {
    const d = await m.hv.datosVentas(ORG, "7d", NOW);
    expect(d.negocio).toBe("SAMER");
    expect(d.periodo.conversaciones).toBe(4);
    const casa = (t: string) => d.casas.find((c) => c.titulo === t);
    expect(casa("V1")).toMatchObject({ estado: "cerrada", visitas: 0 });
    expect(casa("V2")).toMatchObject({ consultas: 2, visitas: 2 });
    expect(casa("V3")).toMatchObject({ consultas: 1, visitas: 0 }); // la próxima es de mañana: fuera del periodo
    expect(casa("V4")).toMatchObject({ consultas: 0, visitas: 0 });
    expect(d.casas.some((c) => c.titulo === "Ajena")).toBe(false);

    expect(d.visitas.proximas.map((v) => [v.contacto, v.casa])).toEqual([["Caro", "V3"]]);
    expect(d.visitas.sinResultado.map((v) => v.contacto)).toEqual(["Beto"]);
    expect(d.visitas.listos.map((v) => v.contacto)).toEqual(["Ana"]);
    expect(d.visitas).toMatchObject({ realizadas: 1, quierenNegociar: 1, interesados: 0 });

    expect(d.noSupoResponder).toEqual([{ contacto: "Caro", pregunta: "¿Tienen estacionamiento para dos autos?" }]);
    expect(d.pidieronPersona).toBe(1);
    expect(d.laboratorio?.score).toBe(17);
    expect(d.agenteEncendido).toBe(false);
  });

  it("el reporte dice a quién llamar y qué enseñarle al agente", async () => {
    const r = await m.hv.reporteVentas(ORG, { now: NOW });
    expect(r.sugerencias[0]?.clave).toBe("llamar_hoy");
    expect(r.sugerencias.map((s) => s.clave)).toContain("ensenar");
    expect(r.texto).toContain("*Llámalos hoy*");
    expect(r.texto).toContain("Ana · V2");
    expect(r.texto).not.toContain("Prueba");
    expect(r.texto).not.toContain("Ajen");
  });
});

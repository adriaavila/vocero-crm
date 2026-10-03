import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Inicio contra Postgres DE VERDAD (opcional — se salta sin
 * `REALDB_TEST_DATABASE_URL`, igual que data-spine-realdb.test.ts):
 *
 *   REALDB_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:PUERTO/db \
 *     pnpm exec vitest run tests/unit/centro-realdb.test.ts
 *
 * La base debe estar migrada. Cada corrida usa un sufijo propio y borra sus
 * negocios al terminar (todo cae en cascada), así que se puede repetir.
 *
 * Lo que una función pura no prueba: quién es candidata a «Por dónde
 * arrancar» (reales, no archivadas, sin contestar), que un negocio nunca vea
 * lo de otro, y los bordes del periodo en las consultas de las cifras.
 */

const REALDB_URL = process.env.REALDB_TEST_DATABASE_URL;
const describeReal = REALDB_URL ? describe : describe.skip;

const SFX = Date.now().toString(36);
const ORG_A = `org_ctA_${SFX}`;
const ORG_B = `org_ctB_${SFX}`;
const ORG_M = `org_ctM_${SFX}`;

const H = 3_600_000;
const NOW = new Date();
const ago = (hours: number) => new Date(NOW.getTime() - hours * H);

type Mod = {
  db: ReturnType<typeof import("@/lib/db").getDb>;
  schema: typeof import("@/lib/db").schema;
  eq: typeof import("drizzle-orm").eq;
  ids: typeof import("@/lib/db/ids");
  prio: typeof import("@/server/agencia/prioridades");
  metr: typeof import("@/server/agencia/centro-metricas");
};
let m: Mod;

type Msg = {
  dir: "in" | "out";
  at: Date;
  text?: string | null;
  type?: string;
  origin?: "ai" | "operator" | "manual" | "template";
  status?: "sent" | "failed";
};

let seq = 0;
async function conversation(
  org: string,
  name: string,
  o: {
    msgs: Msg[];
    test?: boolean;
    archived?: boolean;
    handoff?: { at: Date; reason: "cliente" | "modelo" | "manual_reply" };
    ad?: "ad" | "post";
    aiEnabled?: boolean;
  },
) {
  const n = ++seq;
  const contactId = `ct_${SFX}_${n}`;
  const convId = `cv_${SFX}_${n}`;
  const inbound = o.msgs.filter((x) => x.dir === "in").map((x) => x.at.getTime());
  const all = o.msgs.map((x) => x.at.getTime());
  await m.db.insert(m.schema.contact).values({
    id: contactId,
    organizationId: org,
    waIdentity: `5841${SFX}${n}`.slice(0, 20),
    name,
    archivedAt: o.archived ? NOW : null,
  });
  await m.db.insert(m.schema.conversation).values({
    id: convId,
    organizationId: org,
    contactId,
    isTest: o.test ?? false,
    aiEnabled: o.aiEnabled ?? false,
    handoffAt: o.handoff?.at ?? null,
    handoffReason: o.handoff?.reason ?? null,
    lastInboundAt: inbound.length ? new Date(Math.max(...inbound)) : null,
    lastMessageAt: all.length ? new Date(Math.max(...all)) : null,
  });
  for (const msg of o.msgs) {
    await m.db.insert(m.schema.message).values({
      id: m.ids.newId("message"),
      organizationId: org,
      conversationId: convId,
      direction: msg.dir,
      type: msg.type ?? "text",
      text: msg.text === undefined ? "hola" : msg.text,
      status: msg.status ?? (msg.dir === "in" ? "delivered" : "sent"),
      origin: msg.origin ?? "operator",
      createdAt: msg.at,
      waTimestamp: msg.at,
    });
  }
  if (o.ad) {
    await m.db.insert(m.schema.adAttribution).values({
      id: `aa_${SFX}_${n}`,
      organizationId: org,
      contactId,
      conversationId: convId,
      sourceId: `src_${SFX}`,
      sourceType: o.ad,
      headline: "Anuncio de prueba",
      raw: {},
    });
  }
  return { contactId, convId };
}

describeReal("Inicio — Postgres real", { timeout: 30_000 }, () => {
  beforeAll(async () => {
    Object.assign(process.env, {
      DATABASE_URL: REALDB_URL,
      APP_BASE_URL: "http://localhost:3999",
      BETTER_AUTH_SECRET: "x".repeat(32),
      ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
      META_WEBHOOK_VERIFY_TOKEN: "centro-verify-token",
    });
    const { resetEnvCacheForTests } = await import("@/lib/env");
    resetEnvCacheForTests();
    const dbMod = await import("@/lib/db");
    const orm = await import("drizzle-orm");
    m = {
      db: dbMod.getDb(),
      schema: dbMod.schema,
      eq: orm.eq,
      ids: await import("@/lib/db/ids"),
      prio: await import("@/server/agencia/prioridades"),
      metr: await import("@/server/agencia/centro-metricas"),
    };
    for (const org of [ORG_A, ORG_B, ORG_M]) {
      await m.db.insert(m.schema.organization).values({ id: org, name: org, slug: org });
    }
  });

  afterAll(async () => {
    if (!m) return;
    for (const org of [ORG_A, ORG_B, ORG_M]) {
      await m.db.delete(m.schema.organization).where(m.eq(m.schema.organization.id, org));
    }
  });

  describe("quién es candidata", () => {
    const names = (r: { cards: { name: string }[] }) => r.cards.map((c) => c.name);

    beforeAll(async () => {
      // Entran
      await conversation(ORG_A, "sin-respuesta", { msgs: [{ dir: "in", at: ago(2) }] });
      await conversation(ORG_A, "precio", { msgs: [{ dir: "in", at: ago(3), text: "¿Cuánto cuesta el plan?" }] });
      await conversation(ORG_A, "anuncio", { ad: "ad", msgs: [{ dir: "in", at: ago(1) }] });
      await conversation(ORG_A, "publicacion", { ad: "post", msgs: [{ dir: "in", at: ago(1.5) }] });
      await conversation(ORG_A, "anuncio-conocido", {
        ad: "ad",
        msgs: [
          { dir: "in", at: ago(30) },
          { dir: "out", at: ago(29), origin: "operator" },
          { dir: "in", at: ago(4) },
        ],
      });
      await conversation(ORG_A, "traspaso-con-aviso-del-agente", {
        handoff: { at: ago(5), reason: "cliente" },
        msgs: [
          { dir: "in", at: ago(5), text: "quiero hablar con alguien" },
          { dir: "out", at: ago(4.9), origin: "ai", text: "Te paso con una persona" },
        ],
      });
      await conversation(ORG_A, "salida-fallida", {
        msgs: [
          { dir: "in", at: ago(6) },
          { dir: "out", at: ago(5.9), origin: "operator", status: "failed" },
        ],
      });
      await conversation(ORG_A, "cerrada-30h", { msgs: [{ dir: "in", at: ago(30) }] });
      await conversation(ORG_A, "cerrada-6d", { msgs: [{ dir: "in", at: ago(6 * 24 + 12) }] });
      await conversation(ORG_A, "ultimo-mensaje-solo-imagen", {
        msgs: [{ dir: "in", at: ago(7), text: null, type: "image" }],
      });
      // No entran
      await conversation(ORG_A, "hace-8-dias", { msgs: [{ dir: "in", at: ago(8 * 24) }] });
      await conversation(ORG_A, "contestada-por-el-agente", {
        msgs: [{ dir: "in", at: ago(2) }, { dir: "out", at: ago(1.9), origin: "ai" }],
      });
      await conversation(ORG_A, "contestada-por-persona", {
        msgs: [{ dir: "in", at: ago(2) }, { dir: "out", at: ago(1.9), origin: "operator" }],
      });
      await conversation(ORG_A, "traspaso-ya-contestado", {
        handoff: { at: ago(6), reason: "cliente" },
        msgs: [
          { dir: "in", at: ago(6) },
          { dir: "out", at: ago(5), origin: "operator" },
        ],
      });
      await conversation(ORG_A, "respondio-desde-el-telefono", {
        handoff: { at: ago(3.9), reason: "manual_reply" },
        msgs: [{ dir: "in", at: ago(4) }, { dir: "out", at: ago(3.95), origin: "manual" }],
      });
      await conversation(ORG_A, "del-laboratorio", { test: true, msgs: [{ dir: "in", at: ago(1) }] });
      await conversation(ORG_A, "archivada", { archived: true, msgs: [{ dir: "in", at: ago(1) }] });
      // Otro negocio, con un nombre igual al de uno de A.
      await conversation(ORG_B, "sin-respuesta", { msgs: [{ dir: "in", at: ago(1) }] });
      await conversation(ORG_B, "solo-de-b", { msgs: [{ dir: "in", at: ago(2) }] });
    });

    it("trae las reales, sin archivar y sin contestar, y deja fuera el resto", async () => {
      const r = await m.prio.getPrioridades(ORG_A, { agentOn: false, now: NOW, limit: 100 });
      expect(names(r).sort()).toEqual(
        [
          "anuncio",
          "anuncio-conocido",
          "cerrada-30h",
          "cerrada-6d",
          "precio",
          "publicacion",
          "salida-fallida",
          "sin-respuesta",
          "traspaso-con-aviso-del-agente",
          "ultimo-mensaje-solo-imagen",
        ].sort(),
      );
      expect(r.total).toBe(10);
    });

    it("las razones salen del hilo y del anuncio", async () => {
      const r = await m.prio.getPrioridades(ORG_A, { agentOn: false, now: NOW, limit: 100 });
      const reason = (n: string) => r.cards.find((c) => c.name === n)?.reason;
      expect(reason("traspaso-con-aviso-del-agente")).toBe("persona");
      expect(reason("precio")).toBe("precio");
      expect(reason("anuncio")).toBe("anuncio");
      // Una publicación no es un anuncio; y quien ya fue atendido una vez, tampoco es «primer contacto».
      expect(reason("publicacion")).toBe("sin_respuesta");
      expect(reason("anuncio-conocido")).toBe("sin_respuesta");
      expect(reason("sin-respuesta")).toBe("sin_respuesta");
    });

    it("un saliente que falló no cuenta como respuesta", async () => {
      const r = await m.prio.getPrioridades(ORG_A, { agentOn: false, now: NOW, limit: 100 });
      expect(names(r)).toContain("salida-fallida");
    });

    it("ordena: la ventana que se cierra antes primero; las cerradas, la más reciente", async () => {
      const r = await m.prio.getPrioridades(ORG_A, { agentOn: false, now: NOW, limit: 100 });
      const order = names(r);
      // La ventana que se cierra antes es la del que escribió hace más (de las abiertas).
      expect(order.indexOf("salida-fallida")).toBeLessThan(order.indexOf("precio"));
      expect(order.indexOf("precio")).toBeLessThan(order.indexOf("sin-respuesta"));
      expect(order.indexOf("sin-respuesta")).toBeLessThan(order.indexOf("anuncio"));
      expect(order.slice(-2)).toEqual(["cerrada-30h", "cerrada-6d"]);
      expect(r.closed).toBe(2);
      expect(r.needsYou).toBe(8);
    });

    it("el último mensaje sin texto se muestra por su tipo", async () => {
      const r = await m.prio.getPrioridades(ORG_A, { agentOn: false, now: NOW, limit: 100 });
      expect(r.cards.find((c) => c.name === "ultimo-mensaje-solo-imagen")?.preview).toBe("Imagen");
    });

    it("respeta el tope de tarjetas pero cuenta todas", async () => {
      const r = await m.prio.getPrioridades(ORG_A, { agentOn: false, now: NOW });
      expect(r.cards).toHaveLength(8);
      expect(r.total).toBe(10);
    });

    it("un negocio nunca ve las conversaciones de otro", async () => {
      const a = await m.prio.getPrioridades(ORG_A, { agentOn: false, now: NOW, limit: 100 });
      const b = await m.prio.getPrioridades(ORG_B, { agentOn: false, now: NOW, limit: 100 });
      expect(names(b).sort()).toEqual(["sin-respuesta", "solo-de-b"]);
      expect(names(a)).not.toContain("solo-de-b");
      const idsA = new Set(a.cards.map((c) => c.conversationId));
      for (const c of b.cards) expect(idsA.has(c.conversationId)).toBe(false);
      // Y un negocio sin nada, nada.
      expect((await m.prio.getPrioridades(ORG_M, { agentOn: false, now: NOW })).total).toBe(0);
    });
  });

  describe("las cifras y el borde del periodo", () => {
    // Caracas, UTC−4: el 3 de octubre local va de 04:00Z a 04:00Z del día siguiente.
    const FIXED_NOW = new Date("2026-10-03T18:00:00Z");
    const t = (iso: string) => new Date(iso);

    beforeAll(async () => {
      await m.db.insert(m.schema.agentProfile).values({
        id: `ap_${SFX}`,
        organizationId: ORG_M,
        businessTimezone: "America/Caracas",
      });
      await m.db.insert(m.schema.pipelineStage).values({ id: `stg_${SFX}`, organizationId: ORG_M, name: "Nuevo", position: 0, kind: "open" });
      const edges = [
        ["antes-23:59:59", "2026-10-03T03:59:59Z"],
        ["inicio-00:00:00", "2026-10-03T04:00:00Z"],
        ["fin-23:59:59", "2026-10-04T03:59:59Z"],
        ["siguiente-00:00:00", "2026-10-04T04:00:00Z"],
      ] as const;
      for (const [name, iso] of edges) {
        const { contactId } = await conversation(ORG_M, name, { msgs: [{ dir: "in", at: t(iso) }] });
        await m.db.insert(m.schema.lead).values({
          id: `ld_${SFX}_${name}`,
          organizationId: ORG_M,
          contactId,
          stageId: `stg_${SFX}`,
          createdAt: t(iso),
        });
      }
      // Salientes: dos del agente, una persona, una desde el teléfono, una plantilla, una que falló.
      const out = (origin: Msg["origin"], status: Msg["status"] = "sent") => ({ dir: "out" as const, at: t("2026-10-03T15:00:00Z"), origin, status });
      await conversation(ORG_M, "salientes", {
        msgs: [
          { dir: "in", at: t("2026-10-03T14:59:00Z") },
          out("ai"),
          out("ai"),
          out("operator"),
          out("manual"),
          out("template"),
          out("operator", "failed"),
        ],
      });
      // El Laboratorio no existe para las cifras.
      await conversation(ORG_M, "laboratorio", {
        test: true,
        msgs: [{ dir: "in", at: t("2026-10-03T15:00:00Z") }, out("ai")],
      });
    });

    it("«hoy» cuenta de la medianoche local (incluida) a la siguiente (excluida)", async () => {
      const r = await m.metr.getCentroMetricas(ORG_M, "hoy", FIXED_NOW);
      // inicio, fin y «salientes» (la del Laboratorio no cuenta).
      expect(r.conversations.total).toBe(3);
      const hour = (label: string) => r.conversations.series.find((p) => p.label === label)?.count;
      expect(hour("00")).toBe(1);
      expect(hour("23")).toBe(1);
      expect(hour("10")).toBe(1); // 14:59Z = 10:59 en Caracas
      expect(r.conversations.series).toHaveLength(24);
      expect(r.conversations.series.reduce((n, p) => n + p.count, 0)).toBe(3);
    });

    it("cuenta los leads con el mismo rango semiabierto", async () => {
      const r = await m.metr.getCentroMetricas(ORG_M, "hoy", FIXED_NOW);
      expect(r.leads.total).toBe(2);
    });

    it("separa lo que contestó el agente de lo que contestó una persona (CRM + teléfono), sin plantillas ni fallidos", async () => {
      const r = await m.metr.getCentroMetricas(ORG_M, "hoy", FIXED_NOW);
      expect(r.replies).toEqual({ ai: 2, owner: 2 });
    });

    it("7 días trae la serie diaria completa, con ceros", async () => {
      const r = await m.metr.getCentroMetricas(ORG_M, "7d", FIXED_NOW);
      expect(r.granularity).toBe("day");
      expect(r.conversations.series.map((p) => p.label)).toEqual([
        "2026-09-27", "2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03",
      ]);
      // El que escribió a las 23:59:59 del 2 (03:59:59Z del 3) cuenta para el 2.
      const day = (label: string) => r.conversations.series.find((p) => p.label === label)?.count;
      expect(day("2026-10-02")).toBe(1);
      expect(day("2026-10-03")).toBe(3);
      expect(day("2026-09-30")).toBe(0);
    });

    it("el 4 de octubre local (a las 00:00) todavía no es hoy", async () => {
      const antes = await m.metr.getCentroMetricas(ORG_M, "hoy", new Date("2026-10-04T03:59:59Z"));
      const despues = await m.metr.getCentroMetricas(ORG_M, "hoy", new Date("2026-10-04T04:00:00Z"));
      expect(antes.to).toBe("2026-10-03");
      expect(despues.to).toBe("2026-10-04");
      expect(despues.conversations.total).toBe(1); // solo «siguiente-00:00:00»
    });

    it("un negocio sin mensajes no tiene actividad: las cifras en cero no dicen nada", async () => {
      const vacio = await m.metr.getCentroMetricas(ORG_B.replace("ctB", "ctZ"), "7d", FIXED_NOW);
      expect(vacio.hasActivity).toBe(false);
      expect(vacio.conversations.total).toBe(0);
      expect((await m.metr.getCentroMetricas(ORG_M, "7d", FIXED_NOW)).hasActivity).toBe(true);
    });

    it("cada negocio cuenta lo suyo (A: 16 reales; el del Laboratorio no cuenta. B: 2)", async () => {
      const a = await m.metr.getCentroMetricas(ORG_A, "30d", NOW);
      const b = await m.metr.getCentroMetricas(ORG_B, "30d", NOW);
      expect(a.conversations.total).toBe(16);
      expect(b.conversations.total).toBe(2);
    });
  });
});

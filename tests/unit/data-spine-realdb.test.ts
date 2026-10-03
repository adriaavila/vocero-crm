import { createHmac } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Data spine contra Postgres DE VERDAD (opcional — se salta sin
 * `REALDB_TEST_DATABASE_URL`, igual que nea-cursor-realdb.test.ts):
 *
 *   REALDB_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:PUERTO/db \
 *     pnpm exec vitest run tests/unit/data-spine-realdb.test.ts
 *
 * La base debe estar migrada (`node scripts/migrate.mjs`). Cada corrida usa un
 * sufijo propio y limpia lo suyo, así que se puede repetir sobre la misma base.
 *
 * Lo que un mock no prueba: el webhook REAL (ruta + firma + raw_event + los
 * procesadores de verdad), el dedupe por llave única, los timestamps por estado,
 * el replay, y el aislamiento de tenant de la API de decisiones.
 */

const REALDB_URL = process.env.REALDB_TEST_DATABASE_URL;
const describeReal = REALDB_URL ? describe : describe.skip;

const hoisted = vi.hoisted(() => ({
  maybeRunAgentTurn: vi.fn(),
  session: { current: null as null | { userId: string; organizationId: string; role: string } },
  failMessages: { next: false },
}));

// El agente no es el sujeto de estas pruebas: solo importa SI se le pidió un turno.
vi.mock("@/server/ai/trigger", () => ({ maybeRunAgentTurn: hoisted.maybeRunAgentTurn }));
vi.mock("@/lib/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/session")>();
  return {
    ...actual,
    requireSession: async () => {
      if (!hoisted.session.current) throw new actual.UnauthorizedError();
      return hoisted.session.current;
    },
  };
});
// Un fallo simulado del procesador de mensajes (la BD real no se deja romper a voluntad).
vi.mock("@/server/inbox/ingest", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/inbox/ingest")>();
  return {
    ...actual,
    processMessagesValue: async (...args: Parameters<typeof actual.processMessagesValue>) => {
      if (hoisted.failMessages.next) {
        hoisted.failMessages.next = false;
        throw new Error("boom-simulated");
      }
      return actual.processMessagesValue(...args);
    },
  };
});

const APP_SECRET = "spine-test-app-secret";
const VERIFY_TOKEN = "spine-verify-token";
const SFX = Date.now().toString(36);

const ORG_A = `org_spA_${SFX}`;
const ORG_B = `org_spB_${SFX}`;
const USER_A = `usr_spA_${SFX}`;
const USER_B = `usr_spB_${SFX}`;
const PN_A = `PN-A-${SFX}`;
const PN_NEW = `PN-NEW-${SFX}`;
const WABA_A = `WABA-A-${SFX}`;

type Mod = {
  db: ReturnType<typeof import("@/lib/db").getDb>;
  schema: typeof import("@/lib/db").schema;
  eq: typeof import("drizzle-orm").eq;
  and: typeof import("drizzle-orm").and;
  like: typeof import("drizzle-orm").like;
  sql: typeof import("drizzle-orm").sql;
  raw: typeof import("@/server/agencia/raw-events");
  creds: typeof import("@/server/whatsapp/credentials");
  decisions: typeof import("@/server/agencia/decisions");
  ids: typeof import("@/lib/db/ids");
  webhookPOST: typeof import("@/app/api/webhooks/wa/[webhookToken]/route").POST;
};
let m: Mod;

function waBody(changes: unknown[], entryId = WABA_A): string {
  return JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: entryId, changes }] });
}
const sign = (raw: string) => `sha256=${createHmac("sha256", APP_SECRET).update(raw, "utf8").digest("hex")}`;

async function deliver(raw: string, signature: string | null = sign(raw)): Promise<Response> {
  return m.webhookPOST(
    new Request(`http://localhost/api/webhooks/wa/${VERIFY_TOKEN}`, {
      method: "POST",
      body: raw,
      headers: signature ? { "x-hub-signature-256": signature } : {},
    }),
    { params: Promise.resolve({ webhookToken: VERIFY_TOKEN }) }
  );
}

const meta = (pn: string) => ({ display_phone_number: "584120000000", phone_number_id: pn });
const messagesChange = (pn: string, value: Record<string, unknown>) => ({
  field: "messages",
  value: { messaging_product: "whatsapp", metadata: meta(pn), ...value },
});
// Ahora, no una fecha fija: la ventana de 24 h del envío depende del último entrante.
const nowSecs = () => String(Math.floor(Date.now() / 1000));
let phoneSeq = 0;
const nextPhone = () => `58412${SFX.replace(/\D/g, "").padStart(3, "0").slice(-3)}${String(1000 + phoneSeq++)}`;

function inbound(wamid: string, phone: string, extra: Record<string, unknown> = {}) {
  return messagesChange(PN_A, {
    contacts: [{ profile: { name: `Lead ${wamid.slice(-4)}` }, wa_id: phone }],
    messages: [
      { from: phone, id: wamid, timestamp: nowSecs(), type: "text", text: { body: "hola" }, ...extra },
    ],
  });
}

async function eventFor(field: string, value: unknown) {
  const rows = await m.db
    .select()
    .from(m.schema.rawEvent)
    .where(m.eq(m.schema.rawEvent.dedupeKey, m.raw.dedupeKeyFor(field, value)));
  return rows[0];
}
async function messageByWamid(wamid: string) {
  const rows = await m.db.select().from(m.schema.message).where(m.eq(m.schema.message.waMessageId, wamid));
  return rows[0];
}
const secs = (d: Date | null | undefined) => (d ? d.getTime() / 1000 : null);

/** Un saliente ya enviado por el CRM, como lo dejaría `sendText`. */
async function seedOutbound(conversationId: string, wamid: string, status: "pending" | "sent" = "pending") {
  const id = m.ids.newId("message");
  await m.db.insert(m.schema.message).values({
    id,
    organizationId: ORG_A,
    conversationId,
    waMessageId: wamid,
    direction: "out",
    type: "text",
    text: "respuesta",
    status,
    origin: "operator",
  });
  return id;
}
async function conversationOf(phone: string) {
  const rows = await m.db
    .select({ cv: m.schema.conversation })
    .from(m.schema.conversation)
    .innerJoin(m.schema.contact, m.eq(m.schema.contact.id, m.schema.conversation.contactId))
    .where(m.and(m.eq(m.schema.contact.organizationId, ORG_A), m.eq(m.schema.contact.waIdentity, phone)));
  return rows[0]?.cv;
}

// Las rutas se importan en frío dentro de las pruebas: el primer import tarda.
describeReal("data spine — Postgres real", { timeout: 30_000 }, () => {
  beforeAll(async () => {
    Object.assign(process.env, {
      DATABASE_URL: REALDB_URL,
      APP_BASE_URL: "http://localhost:3999",
      BETTER_AUTH_SECRET: "x".repeat(32),
      ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
      META_WEBHOOK_VERIFY_TOKEN: VERIFY_TOKEN,
      META_APP_SECRET: APP_SECRET,
      META_GRAPH_BASE_URL: "http://graph.invalid",
    });
    delete process.env.NEA_DISPATCH_URL;
    delete process.env.WA_MOCK_ENABLED;
    const { resetEnvCacheForTests } = await import("@/lib/env");
    resetEnvCacheForTests();

    const dbMod = await import("@/lib/db");
    const orm = await import("drizzle-orm");
    m = {
      db: dbMod.getDb(),
      schema: dbMod.schema,
      eq: orm.eq,
      and: orm.and,
      like: orm.like,
      sql: orm.sql,
      raw: await import("@/server/agencia/raw-events"),
      creds: await import("@/server/whatsapp/credentials"),
      decisions: await import("@/server/agencia/decisions"),
      ids: await import("@/lib/db/ids"),
      webhookPOST: (await import("@/app/api/webhooks/wa/[webhookToken]/route")).POST,
    };

    for (const [org, user] of [
      [ORG_A, USER_A],
      [ORG_B, USER_B],
    ] as const) {
      await m.db.insert(m.schema.organization).values({ id: org, name: org, slug: org });
      await m.db.insert(m.schema.user).values({ id: user, name: user, email: `${user}@spine.test` });
      await m.db
        .insert(m.schema.pipelineStage)
        .values({ id: `stg_${org}`, organizationId: org, name: "Nuevo", position: 0, kind: "open" });
    }
    await m.creds.saveCredentials({
      organizationId: ORG_A,
      wabaId: WABA_A,
      phoneNumberId: PN_A,
      token: "token-de-prueba",
    });
  }, 60_000);

  afterEach(() => {
    hoisted.maybeRunAgentTurn.mockClear();
    hoisted.failMessages.next = false;
    hoisted.session.current = null;
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    if (!m) return;
    // Los eventos sin organización no caen en cascada: se borran por su marca.
    await m.db.delete(m.schema.rawEvent).where(m.like(m.schema.rawEvent.accountRef, `%${SFX}%`));
    await m.db.delete(m.schema.rawEvent).where(m.sql`${m.schema.rawEvent.payload}::text like ${"%" + SFX + "%"}`);
    for (const org of [ORG_A, ORG_B]) {
      await m.db.delete(m.schema.organization).where(m.eq(m.schema.organization.id, org));
    }
    for (const user of [USER_A, USER_B]) {
      await m.db.delete(m.schema.user).where(m.eq(m.schema.user.id, user));
    }
  });

  /* ---------------- Captura ---------------- */

  describe("captura", () => {
    it("inbound de texto: raw_event processed con su organización; el mensaje apunta a él y pide un turno del agente", async () => {
      const wamid = `wamid.in.${SFX}.1`;
      const change = inbound(wamid, nextPhone());

      const res = await deliver(waBody([change]));

      expect(res.status).toBe(200);
      const ev = (await eventFor("messages", change.value))!;
      expect(ev).toMatchObject({
        channel: "whatsapp",
        organizationId: ORG_A,
        accountRef: PN_A,
        field: "messages",
        status: "processed",
        attempts: 1,
        error: null,
      });
      expect(ev.processedAt).toBeInstanceOf(Date);
      // El cambio TAL COMO LLEGÓ.
      expect(ev.payload).toEqual({ entryId: WABA_A, field: "messages", value: change.value });
      const msg = (await messageByWamid(wamid))!;
      expect(msg).toMatchObject({ organizationId: ORG_A, direction: "in", text: "hola", rawEventId: ev.id });
      expect(msg.replyToWaId).toBeNull();
      expect(hoisted.maybeRunAgentTurn).toHaveBeenCalledTimes(1);
    });

    it("webhook duplicado: una sola fila raw_event, un solo mensaje y un solo turno del agente", async () => {
      const wamid = `wamid.in.${SFX}.dup`;
      const change = inbound(wamid, nextPhone());
      const raw = waBody([change]);

      expect((await deliver(raw)).status).toBe(200);
      expect((await deliver(raw)).status).toBe(200);
      // El mismo cambio reordenado por llaves sigue siendo el mismo evento.
      expect(m.raw.dedupeKeyFor("messages", { b: 1, a: 2 })).toBe(m.raw.dedupeKeyFor("messages", { a: 2, b: 1 }));

      const events = await m.db
        .select()
        .from(m.schema.rawEvent)
        .where(m.eq(m.schema.rawEvent.dedupeKey, m.raw.dedupeKeyFor("messages", change.value)));
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ status: "processed", attempts: 1 }); // el 2º POST no reprocesó
      const msgs = await m.db.select().from(m.schema.message).where(m.eq(m.schema.message.waMessageId, wamid));
      expect(msgs).toHaveLength(1);
      expect(hoisted.maybeRunAgentTurn).toHaveBeenCalledTimes(1);
    });

    it("reintento tras un fallo: 503 con el evento failed (attempts 1); el reintento de Meta lo deja processed con attempts 2", async () => {
      const wamid = `wamid.in.${SFX}.retry`;
      const change = inbound(wamid, nextPhone());
      const raw = waBody([change]);
      hoisted.failMessages.next = true;

      const first = await deliver(raw);

      expect(first.status).toBe(503);
      const failed = (await eventFor("messages", change.value))!;
      expect(failed).toMatchObject({ status: "failed", attempts: 1, organizationId: ORG_A });
      expect(failed.error).toContain("boom-simulated");
      expect(await messageByWamid(wamid)).toBeUndefined();

      const second = await deliver(raw); // Meta reintenta el MISMO payload
      expect(second.status).toBe(200);
      const done = (await eventFor("messages", change.value))!;
      expect(done).toMatchObject({ id: failed.id, status: "processed", attempts: 2, error: null });
      expect((await messageByWamid(wamid))!.rawEventId).toBe(failed.id);
      expect(hoisted.maybeRunAgentTurn).toHaveBeenCalledTimes(1);
    });

    it("respuesta con context.id: reply_to_wa_id guarda el wamid al que contesta", async () => {
      const wamid = `wamid.in.${SFX}.reply`;
      await deliver(waBody([inbound(wamid, nextPhone(), { context: { from: "584120000000", id: `wamid.orig.${SFX}` } })]));
      expect((await messageByWamid(wamid))!.replyToWaId).toBe(`wamid.orig.${SFX}`);
    });

    it("echo desde el teléfono: origin manual, reply_to, sent_at del evento, raw_event_id; pausa la IA y no pide turno", async () => {
      const phone = nextPhone();
      await deliver(waBody([inbound(`wamid.in.${SFX}.echo0`, phone)])); // abre la conversación
      hoisted.maybeRunAgentTurn.mockClear();
      const wamid = `wamid.echo.${SFX}.1`;
      const change = {
        field: "smb_message_echoes",
        value: {
          messaging_product: "whatsapp",
          metadata: meta(PN_A),
          message_echoes: [
            {
              from: "584120000000",
              to: phone,
              id: wamid,
              timestamp: "1790000100",
              type: "text",
              text: { body: "te llamo en 5" },
              context: { id: `wamid.in.${SFX}.echo0` },
            },
          ],
        },
      };

      expect((await deliver(waBody([change]))).status).toBe(200);

      const ev = (await eventFor("smb_message_echoes", change.value))!;
      expect(ev).toMatchObject({ status: "processed", organizationId: ORG_A });
      const msg = (await messageByWamid(wamid))!;
      expect(msg).toMatchObject({
        direction: "out",
        origin: "manual",
        status: "sent",
        replyToWaId: `wamid.in.${SFX}.echo0`,
        rawEventId: ev.id,
        senderUserId: null,
      });
      expect(secs(msg.sentAt)).toBe(1790000100);
      expect(hoisted.maybeRunAgentTurn).not.toHaveBeenCalled();
      const cv = (await conversationOf(phone))!;
      expect(cv).toMatchObject({ aiEnabled: false, handoffReason: "manual_reply" });
    });

    it("campo desconocido: se guarda y queda ignored", async () => {
      const change = { field: "account_update", value: { event: `VERIFIED_${SFX}`, phone_number: "584120000000" } };
      expect((await deliver(waBody([change]))).status).toBe(200);
      expect(await eventFor("account_update", change.value)).toMatchObject({ status: "ignored", attempts: 1 });
    });

    it("cuerpo ilegible con firma válida: 200 y queda como `_unparsed` failed con el texto crudo", async () => {
      const raw = `{"entry": [oops ${SFX}`;
      expect((await deliver(raw)).status).toBe(200);
      const rows = await m.db
        .select()
        .from(m.schema.rawEvent)
        .where(m.eq(m.schema.rawEvent.dedupeKey, m.raw.dedupeKeyFor("_unparsed", raw)));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        field: "_unparsed",
        status: "failed",
        error: "invalid_json",
        organizationId: null,
        payload: { body: raw },
      });
    });

    it("firma inválida: 401 y NO queda nada guardado", async () => {
      const wamid = `wamid.in.${SFX}.badsig`;
      const change = inbound(wamid, nextPhone());
      const raw = waBody([change]);

      expect((await deliver(raw, "sha256=" + "0".repeat(64))).status).toBe(401);
      expect((await deliver(raw, null)).status).toBe(401);
      expect((await deliver(`{roto ${SFX}`, "sha256=" + "0".repeat(64))).status).toBe(401);

      expect(await eventFor("messages", change.value)).toBeUndefined();
      expect(await messageByWamid(wamid)).toBeUndefined();
      const leaked = await m.db
        .select()
        .from(m.schema.rawEvent)
        .where(m.eq(m.schema.rawEvent.dedupeKey, m.raw.dedupeKeyFor("_unparsed", `{roto ${SFX}`)));
      expect(leaked).toHaveLength(0);
    });

    it("jsonb: un NUL en el payload no impide guardar el evento crudo (se guarda sin el NUL)", async () => {
      const change = { field: "account_update", value: { event: `NUL_${SFX}`, name: "Neg\u0000ocio" } };
      expect((await deliver(waBody([change]))).status).toBe(200);
      const ev = (await eventFor("account_update", change.value))!;
      expect(ev.status).toBe("ignored");
      expect(ev.payload).toMatchObject({ value: { name: "Negocio" } });
    });

    it("CTWA: el referral sigue entrando a ad_attribution y además queda en el evento crudo", async () => {
      const phone = nextPhone();
      const wamid = `wamid.in.${SFX}.ctwa`;
      const referral = {
        source_url: "https://fb.me/abc",
        source_id: `ad_${SFX}`,
        source_type: "ad",
        headline: "Limpieza dental",
        body: "Agenda hoy",
        media_type: "image",
        ctwa_clid: `ARA${SFX}`,
      };
      const change = inbound(wamid, phone, { referral });

      expect((await deliver(waBody([change]))).status).toBe(200);

      const cv = (await conversationOf(phone))!;
      const att = await m.db
        .select()
        .from(m.schema.adAttribution)
        .where(m.eq(m.schema.adAttribution.conversationId, cv.id));
      expect(att).toHaveLength(1);
      expect(att[0]).toMatchObject({ organizationId: ORG_A, sourceId: `ad_${SFX}`, headline: "Limpieza dental" });
      const ev = (await eventFor("messages", change.value))!;
      expect(JSON.stringify(ev.payload)).toContain(`ARA${SFX}`); // replayable con su ctwa_clid
    });
  });

  /* ---------------- Estados con timestamps ---------------- */

  describe("estados", () => {
    async function convFor(phone: string) {
      await deliver(waBody([inbound(`wamid.in.${SFX}.st-${phone.slice(-4)}`, phone)]));
      return (await conversationOf(phone))!;
    }
    const statusChange = (wamid: string, status: string, ts: number, extra: Record<string, unknown> = {}) =>
      messagesChange(PN_A, { statuses: [{ id: wamid, status, timestamp: String(ts), recipient_id: "x", ...extra }] });

    it("sent → delivered → read: sube el estado y cada marca lleva el timestamp de Meta", async () => {
      const cv = await convFor(nextPhone());
      const wamid = `wamid.out.${SFX}.flow`;
      await seedOutbound(cv.id, wamid);

      for (const [status, ts] of [["sent", 1790000200], ["delivered", 1790000205], ["read", 1790000390]] as const) {
        expect((await deliver(waBody([statusChange(wamid, status, ts)]))).status).toBe(200);
      }

      const msg = (await messageByWamid(wamid))!;
      expect(msg.status).toBe("read");
      expect([secs(msg.sentAt), secs(msg.deliveredAt), secs(msg.readAt), msg.failedAt]).toEqual([
        1790000200, 1790000205, 1790000390, null,
      ]);
    });

    it("delivered TARDÍO tras read: el estado no baja, pero delivered_at se llena; un repetido no pisa la primera marca", async () => {
      const cv = await convFor(nextPhone());
      const wamid = `wamid.out.${SFX}.late`;
      await seedOutbound(cv.id, wamid);
      await deliver(waBody([statusChange(wamid, "sent", 1790000300)]));
      await deliver(waBody([statusChange(wamid, "read", 1790000400)]));

      await deliver(waBody([statusChange(wamid, "delivered", 1790000310)]));
      let msg = (await messageByWamid(wamid))!;
      expect(msg.status).toBe("read");
      expect(secs(msg.deliveredAt)).toBe(1790000310);
      expect(secs(msg.readAt)).toBe(1790000400);

      await deliver(waBody([statusChange(wamid, "delivered", 1790009999)]));
      msg = (await messageByWamid(wamid))!;
      expect(secs(msg.deliveredAt)).toBe(1790000310);
    });

    it("failed: guarda failed_at y el motivo traducido", async () => {
      const cv = await convFor(nextPhone());
      const wamid = `wamid.out.${SFX}.fail`;
      await seedOutbound(cv.id, wamid, "sent");

      await deliver(waBody([statusChange(wamid, "failed", 1790000500, { errors: [{ code: 131047, title: "Re-engagement" }] })]));

      const msg = (await messageByWamid(wamid))!;
      expect(msg.status).toBe("failed");
      expect(secs(msg.failedAt)).toBe(1790000500);
      expect(msg.error).toBeTruthy();
    });

    it("estado de un wamid desconocido: unmatched; cuando el mensaje existe, el replay lo aplica", async () => {
      const cv = await convFor(nextPhone());
      const wamid = `wamid.out.${SFX}.early`;
      const change = statusChange(wamid, "sent", 1790000600);

      expect((await deliver(waBody([change]))).status).toBe(200);
      const ev = (await eventFor("messages", change.value))!;
      expect(ev).toMatchObject({ status: "unmatched", organizationId: ORG_A, attempts: 1 });

      // El envío por fin guarda el mensaje (el estado llegó antes que el INSERT).
      await seedOutbound(cv.id, wamid);
      const summary = await m.raw.replayRawEvents({ organizationId: ORG_A, since: new Date(Date.now() - 3600_000) });
      expect(summary.processed).toBeGreaterThanOrEqual(1);

      expect(await eventFor("messages", change.value)).toMatchObject({ id: ev.id, status: "processed", attempts: 2 });
      const msg = (await messageByWamid(wamid))!;
      expect(msg.status).toBe("sent");
      expect(secs(msg.sentAt)).toBe(1790000600);
    });
  });

  /* ---------------- Replay de lo sin enrutar ---------------- */

  describe("replay", () => {
    it("número desconocido: unrouted (sin mensaje); al conectar el número, el replay lo procesa en la organización correcta", async () => {
      const phone = nextPhone();
      const wamid = `wamid.in.${SFX}.unrouted`;
      const change = messagesChange(PN_NEW, {
        contacts: [{ profile: { name: "Cliente nuevo" }, wa_id: phone }],
        messages: [{ from: phone, id: wamid, timestamp: "1790000700", type: "text", text: { body: "hola?" } }],
      });

      expect((await deliver(waBody([change], `WABA-NEW-${SFX}`))).status).toBe(200);
      const ev = (await eventFor("messages", change.value))!;
      expect(ev).toMatchObject({ status: "unrouted", organizationId: null, accountRef: PN_NEW, attempts: 1 });
      expect(await messageByWamid(wamid)).toBeUndefined();

      // Un replay SIN que el número esté conectado no inventa nada.
      expect(await m.raw.replayRawEvents({ organizationId: ORG_B })).toMatchObject({ processed: 0 });
      expect((await messageByWamid(wamid))).toBeUndefined();

      await m.creds.saveCredentials({
        organizationId: ORG_B,
        wabaId: `WABA-NEW-${SFX}`,
        phoneNumberId: PN_NEW,
        token: "otro-token",
      });
      const summary = await m.raw.replayRawEvents({ organizationId: ORG_B });

      expect(summary.processed).toBeGreaterThanOrEqual(1);
      expect(await eventFor("messages", change.value)).toMatchObject({
        id: ev.id,
        status: "processed",
        organizationId: ORG_B,
        attempts: 2,
      });
      const msg = (await messageByWamid(wamid))!;
      expect(msg).toMatchObject({ organizationId: ORG_B, rawEventId: ev.id, text: "hola?" });
    });

    it("el replay de un organizationId no toca los eventos sin enrutar de otro número", async () => {
      const change = messagesChange(`PN-OTRO-${SFX}`, {
        messages: [{ from: nextPhone(), id: `wamid.in.${SFX}.otro`, timestamp: "1", type: "text", text: { body: "x" } }],
      });
      await deliver(waBody([change], `WABA-OTRO-${SFX}`));
      await m.raw.replayRawEvents({ organizationId: ORG_A });
      expect(await eventFor("messages", change.value)).toMatchObject({ status: "unrouted", organizationId: null });
    });
  });

  /* ---------------- sender_user_id ---------------- */

  describe("remitente del operador", () => {
    it("un envío desde el CRM guarda quién lo mandó (sender_user_id); lo manual y lo entrante, no", async () => {
      const phone = nextPhone();
      await deliver(waBody([inbound(`wamid.in.${SFX}.snd`, phone)]));
      const cv = (await conversationOf(phone))!;
      hoisted.session.current = { userId: USER_A, organizationId: ORG_A, role: "owner" };
      const wamid = `wamid.sent.${SFX}.op`;
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ messages: [{ id: wamid }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      );
      const { POST } = await import("@/app/api/conversations/[id]/messages/route");

      const res = await POST(
        new Request("http://x", { method: "POST", body: JSON.stringify({ text: "Claro, te ayudo" }) }),
        { params: Promise.resolve({ id: cv.id }) }
      );

      expect(res.status).toBe(200);
      const msg = (await messageByWamid(wamid))!;
      expect(msg).toMatchObject({ direction: "out", origin: "operator", senderUserId: USER_A });
      const inboundMsg = (await messageByWamid(`wamid.in.${SFX}.snd`))!;
      expect(inboundMsg.senderUserId).toBeNull();
    });
  });

  /* ---------------- Decisiones ---------------- */

  describe("decisiones del agente", () => {
    async function seedConversation(org: string, tag: string, name = `Contacto ${tag}`) {
      const contactId = m.ids.newId("contact");
      const conversationId = m.ids.newId("conversation");
      await m.db.insert(m.schema.contact).values({
        id: contactId,
        organizationId: org,
        waIdentity: `58499${SFX.replace(/\D/g, "").padStart(3, "0").slice(-3)}${tag}`,
        phone: null,
        name,
      });
      await m.db
        .insert(m.schema.conversation)
        .values({ id: conversationId, organizationId: org, contactId, aiEnabled: true });
      return conversationId;
    }
    async function seedMessage(org: string, conversationId: string, direction: "in" | "out", text: string, id?: string) {
      const mid = id ?? m.ids.newId("message");
      await m.db.insert(m.schema.message).values({
        id: mid,
        organizationId: org,
        conversationId,
        direction,
        type: "text",
        text,
        status: direction === "in" ? "delivered" : "sent",
        origin: direction === "in" ? "operator" : "ai",
      });
      return mid;
    }

    it("Nea CON `decision`: la fila guarda modelo, prompt, pasos, tokens y enlaza lo que contestó", async () => {
      const cv = await seedConversation(ORG_A, "n01");
      const trigger = await seedMessage(ORG_A, cv, "in", "cuánto cuesta?");
      const dispatchId = `aj_${SFX}_1`;
      const replyId = m.ids.neaMessageId(ORG_A, cv, dispatchId, 0);
      await seedMessage(ORG_A, cv, "out", "40 USD", replyId);

      const id = await m.decisions.recordNeaDecision({
        organizationId: ORG_A,
        conversationId: cv,
        isTest: false,
        dispatchId,
        triggerMessageIds: [trigger],
        body: {
          ok: true,
          action: "replied",
          handoff: { reason: "cliente", applied: true },
          decision: {
            model: "gpt-4o-mini",
            promptVersion: "p9",
            latencyMs: 1500,
            tokens: { input: 700, output: 40 },
            steps: [{ tool: "buscar_kb", summary: "precio limpieza", ok: true }],
          },
        },
      });

      const row = (await m.db.select().from(m.schema.agentDecision).where(m.eq(m.schema.agentDecision.id, id!)))[0]!;
      expect(row).toMatchObject({
        organizationId: ORG_A,
        conversationId: cv,
        brain: "nea",
        dispatchId,
        action: "replied",
        handoffReason: "cliente",
        model: "gpt-4o-mini",
        promptVersion: "p9",
        latencyMs: 1500,
        inputTokens: 700,
        outputTokens: 40,
        steps: [{ tool: "buscar_kb", summary: "precio limpieza", ok: true }],
        triggerMessageIds: [trigger],
        replyMessageIds: [replyId],
        verdict: null,
      });
    });

    it("Nea SIN `decision` y una conversación del Laboratorio", async () => {
      const cv = await seedConversation(ORG_A, "n02");
      const id = await m.decisions.recordNeaDecision({
        organizationId: ORG_A,
        conversationId: cv,
        isTest: false,
        dispatchId: `aj_${SFX}_2`,
        triggerMessageIds: [],
        body: { ok: true, action: "silent" },
      });
      const row = (await m.db.select().from(m.schema.agentDecision).where(m.eq(m.schema.agentDecision.id, id!)))[0]!;
      expect(row).toMatchObject({ action: "silent", model: null, steps: [], replyMessageIds: [], inputTokens: null });

      const lab = await m.decisions.recordNeaDecision({
        organizationId: ORG_A,
        conversationId: cv,
        isTest: true,
        dispatchId: `aj_${SFX}_3`,
        triggerMessageIds: [],
        body: { ok: true, action: "replied" },
      });
      expect(lab).toBeNull();
    });

    it("Rei: la fila queda con brain rei, modelo, tokens y prompt_version de 12 hex", async () => {
      const cv = await seedConversation(ORG_A, "r01");
      const trigger = await seedMessage(ORG_A, cv, "in", "hola");
      const reply = await seedMessage(ORG_A, cv, "out", "¡Hola!");

      const id = await m.decisions.recordAgentDecision({
        organizationId: ORG_A,
        conversationId: cv,
        isTest: false,
        brain: "rei",
        action: "reply",
        model: "gpt-4o-mini",
        promptVersion: m.decisions.promptVersionOf("prompt compilado"),
        latencyMs: 900,
        tokens: { input: 500, output: 20 },
        triggerMessageIds: [trigger],
        replyMessageIds: [reply],
      });

      const row = (await m.db.select().from(m.schema.agentDecision).where(m.eq(m.schema.agentDecision.id, id!)))[0]!;
      expect(row).toMatchObject({ brain: "rei", dispatchId: null, action: "reply", inputTokens: 500, outputTokens: 20 });
      expect(row.promptVersion).toMatch(/^[0-9a-f]{12}$/);
    });

    describe("API (aislamiento de tenant)", () => {
      let cvA: string;
      let cvB: string;
      let decA: string[] = [];
      let decB: string;

      beforeAll(async () => {
        cvA = await seedConversation(ORG_A, "a01", "Ana de A");
        cvB = await seedConversation(ORG_B, "b01", "Beto de B");
        const trig = await seedMessage(ORG_A, cvA, "in", "x".repeat(300));
        const rep = await seedMessage(ORG_A, cvA, "out", "Respuesta del agente");
        // Cuatro del MISMO milisegundo de creación: la paginación no puede perder ni repetir.
        const stamp = new Date();
        decA = [];
        for (let i = 0; i < 4; i++) {
          const id = m.ids.newId("agentDecision");
          decA.push(id);
          await m.db.insert(m.schema.agentDecision).values({
            id,
            organizationId: ORG_A,
            conversationId: cvA,
            brain: "rei",
            action: i === 0 ? "handoff" : "reply",
            handoffReason: i === 0 ? "modelo" : null,
            triggerMessageIds: [trig],
            replyMessageIds: i === 1 ? [rep] : [],
            createdAt: stamp,
          });
        }
        decB = m.ids.newId("agentDecision");
        await m.db.insert(m.schema.agentDecision).values({
          id: decB,
          organizationId: ORG_B,
          conversationId: cvB,
          brain: "nea",
          action: "replied",
        });
      });

      const as = (org: string, user: string) => {
        hoisted.session.current = { userId: user, organizationId: org, role: "member" };
      };
      const list = async (query = "") => {
        const { GET } = await import("@/app/api/decisions/route");
        return GET(new Request(`http://x/api/decisions${query}`));
      };
      const patch = async (id: string, body: unknown) => {
        const { PATCH } = await import("@/app/api/decisions/[id]/route");
        return PATCH(new Request(`http://x/api/decisions/${id}`, { method: "PATCH", body: JSON.stringify(body) }), {
          params: Promise.resolve({ id }),
        });
      };
      const listConv = async (id: string) => {
        const { GET } = await import("@/app/api/conversations/[id]/decisions/route");
        return GET(new Request(`http://x/api/conversations/${id}/decisions`), { params: Promise.resolve({ id }) });
      };

      it("el listado de A solo trae lo de A, con contacto y previews de ≤140 caracteres", async () => {
        as(ORG_A, USER_A);
        const res = await list("?limit=100");
        expect(res.status).toBe(200);
        const body = (await res.json()) as { decisions: Record<string, unknown>[] };
        const ids = body.decisions.map((d) => d.id);
        expect(ids).toEqual(expect.arrayContaining(decA));
        expect(ids).not.toContain(decB);

        const withReply = body.decisions.find((d) => d.id === decA[1])!;
        expect(withReply).toMatchObject({ contactName: "Ana de A", brain: "rei", replyPreview: "Respuesta del agente" });
        expect((withReply.triggerPreview as string).length).toBeLessThanOrEqual(140);
        expect(withReply.triggerPreview).toMatch(/^x+…$/);
        // Nada del evento crudo viaja al cliente.
        expect(JSON.stringify(body)).not.toMatch(/raw_event|rawEvent|dedupe/i);
      });

      it("el listado de B no ve las de A", async () => {
        as(ORG_B, USER_B);
        const body = (await (await list("?limit=100")).json()) as { decisions: { id: string; contactName: string }[] };
        const ids = body.decisions.map((d) => d.id);
        expect(ids).toContain(decB);
        for (const id of decA) expect(ids).not.toContain(id);
        expect(body.decisions.find((d) => d.id === decB)!.contactName).toBe("Beto de B");
      });

      it("B no puede calificar la decisión de A: 404 y el veredicto de A queda intacto", async () => {
        as(ORG_B, USER_B);
        const res = await patch(decA[0]!, { verdict: "bien", note: "intento ajeno" });
        expect(res.status).toBe(404);
        const row = (await m.db.select().from(m.schema.agentDecision).where(m.eq(m.schema.agentDecision.id, decA[0]!)))[0]!;
        expect(row).toMatchObject({ verdict: null, verdictNote: null, verdictBy: null, verdictAt: null });
      });

      it("B no puede leer las decisiones de una conversación de A: 404", async () => {
        as(ORG_B, USER_B);
        expect((await listConv(cvA)).status).toBe(404);
        as(ORG_A, USER_A);
        const ok = await listConv(cvA);
        expect(ok.status).toBe(200);
        expect(((await ok.json()) as { decisions: unknown[] }).decisions).toHaveLength(4);
      });

      it("A califica: queda quién y cuándo; validación de verdict y nota; null lo borra", async () => {
        as(ORG_A, USER_A);
        const target = decA[2]!;

        const bad = await patch(target, { verdict: "regular" });
        expect(bad.status).toBe(422);
        expect((await patch(target, { verdict: "bien", note: "n".repeat(501) })).status).toBe(422);

        const ok = await patch(target, { verdict: "fallo", note: "  no pidió la dirección  " });
        expect(ok.status).toBe(200);
        let row = (await m.db.select().from(m.schema.agentDecision).where(m.eq(m.schema.agentDecision.id, target)))[0]!;
        expect(row).toMatchObject({ verdict: "fallo", verdictNote: "no pidió la dirección", verdictBy: USER_A });
        expect(row.verdictAt).toBeInstanceOf(Date);

        // Otro miembro de la misma organización puede corregirlo; la nota no sobrevive sin `note`.
        const changed = await patch(target, { verdict: "bien" });
        expect(changed.status).toBe(200);
        row = (await m.db.select().from(m.schema.agentDecision).where(m.eq(m.schema.agentDecision.id, target)))[0]!;
        expect(row).toMatchObject({ verdict: "bien", verdictNote: null });

        const cleared = await patch(target, { verdict: null });
        expect(cleared.status).toBe(200);
        row = (await m.db.select().from(m.schema.agentDecision).where(m.eq(m.schema.agentDecision.id, target)))[0]!;
        expect(row).toMatchObject({ verdict: null, verdictNote: null, verdictBy: null, verdictAt: null });
      });

      it("filtro por veredicto y paginación por cursor sin perder ni repetir filas del mismo instante", async () => {
        as(ORG_A, USER_A);
        await patch(decA[3]!, { verdict: "bien" });

        const seen: string[] = [];
        let cursor: string | null = null;
        for (let page = 0; page < 10; page++) {
          const res: Response = await list(`?limit=2&verdict=none${cursor ? `&cursor=${cursor}` : ""}`);
          const body = (await res.json()) as { decisions: { id: string; verdict: string | null }[]; nextCursor: string | null };
          for (const d of body.decisions) {
            expect(d.verdict).toBeNull();
            seen.push(d.id);
          }
          cursor = body.nextCursor;
          if (!cursor) break;
        }
        const mine = seen.filter((id) => decA.includes(id));
        expect(new Set(seen).size).toBe(seen.length); // sin repetidos
        expect(mine.sort()).toEqual(decA.filter((id) => id !== decA[3]).sort()); // la calificada no aparece

        const bien = (await (await list("?verdict=bien&limit=100")).json()) as { decisions: { id: string }[] };
        expect(bien.decisions.map((d) => d.id)).toEqual([decA[3]]);
        expect((await list("?cursor=AAAA")).status).toBe(422);
      });
    });
  });
});

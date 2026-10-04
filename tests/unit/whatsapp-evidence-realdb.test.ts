import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Pruebas contra Postgres DE VERDAD (opcionales, se saltan sin
 * `REALDB_TEST_DATABASE_URL`): la evidencia de que el canal funciona se cuenta
 * por separado (recibido / entregado) y solo con tráfico en vivo.
 *
 *   REALDB_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:PUERTO/db \
 *     pnpm exec vitest run tests/unit/whatsapp-evidence-realdb.test.ts
 */

// Las columnas `timestamp` sin zona se leen en la hora del proceso: el servidor
// corre en UTC, y la prueba también para no depender de la máquina.
process.env.TZ = "UTC";

const REALDB_URL = process.env.REALDB_TEST_DATABASE_URL;
const describeReal = REALDB_URL ? describe : describe.skip;

describeReal("real Postgres, evidencia de la conexión de WhatsApp", () => {
  const suffix = Math.random().toString(36).slice(2, 8);
  const org = `org_evid_${suffix}`;
  const at = (iso: string) => iso.replace("T", " ").replace("Z", "");

  beforeAll(() => {
    Object.assign(process.env, {
      DATABASE_URL: REALDB_URL,
      APP_BASE_URL: "http://localhost:3999",
      BETTER_AUTH_SECRET: "x".repeat(32),
      ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
      META_WEBHOOK_VERIFY_TOKEN: "verifytoken",
    });
  });

  afterAll(async () => {
    const { getSql } = await import("@/lib/db");
    await getSql()`delete from organization where id = ${org}`;
  });

  it(
    "recibido y entregado salen por separado y ni el Laboratorio, ni el historial, ni el eco del teléfono cuentan",
    async () => {
      const { getSql } = await import("@/lib/db");
      const sql = getSql();
      await sql`insert into organization (id, name, slug, created_at) values (${org}, ${org}, ${org}, now())`;
      await sql`insert into contact (id, organization_id, wa_identity, phone, name) values (${"ct_" + suffix}, ${org}, ${"5215500" + suffix}, null, 'Lead')`;
      await sql`insert into contact (id, organization_id, wa_identity, phone, name) values (${"ct_ig_" + suffix}, ${org}, ${"ig:" + suffix}, null, 'Lead IG')`;
      const conv = async (id: string, contact: string, isTest: boolean, channel = "whatsapp") =>
        sql`insert into conversation (id, organization_id, contact_id, is_test, channel) values (${id}, ${org}, ${contact}, ${isTest}, ${channel})`;
      await conv("cv_live_" + suffix, "ct_" + suffix, false);
      await conv("cv_test_" + suffix, "ct_" + suffix, true);
      await conv("cv_ig_" + suffix, "ct_ig_" + suffix, false, "instagram");
      const msg = async (
        id: string,
        conversation: string,
        direction: "in" | "out",
        status: string,
        origin: string,
        created: string,
      ) =>
        sql`insert into message (id, organization_id, conversation_id, direction, type, text, status, origin, created_at)
            values (${id + suffix}, ${org}, ${conversation + suffix}, ${direction}, 'text', 'x', ${status}, ${origin}, ${at(created)}::timestamp)`;

      // Tráfico en vivo.
      await msg("m1", "cv_live_", "in", "delivered", "operator", "2026-10-03T10:00:00Z");
      await msg("m2", "cv_live_", "out", "sent", "ai", "2026-10-03T10:01:00Z"); // aceptada, no entregada
      await msg("m3", "cv_live_", "out", "delivered", "ai", "2026-10-03T10:02:00Z");
      // Lo que NO cuenta, aunque sea más reciente.
      await msg("m4", "cv_test_", "in", "delivered", "operator", "2026-10-03T11:00:00Z"); // Laboratorio
      await msg("m5", "cv_live_", "in", "delivered", "history", "2026-10-03T11:01:00Z"); // historial importado
      await msg("m6", "cv_live_", "out", "read", "manual", "2026-10-03T11:02:00Z"); // eco de la app del teléfono
      await msg("m7", "cv_ig_", "in", "delivered", "operator", "2026-10-03T11:03:00Z"); // otro canal
      await msg("m8", "cv_live_", "out", "read", "history", "2026-10-03T11:04:00Z");

      const { getConnectionEvidence } = await import("@/server/onboarding/status");
      const all = await getConnectionEvidence(org, null);
      expect(all.lastInboundAt?.toISOString()).toBe("2026-10-03T10:00:00.000Z");
      expect(all.lastDeliveredAt?.toISOString()).toBe("2026-10-03T10:02:00.000Z");

      // Una reconexión posterior vuelve a dejar el canal «por verificar».
      const after = await getConnectionEvidence(org, new Date("2026-10-03T12:00:00Z"));
      expect(after).toEqual({ lastInboundAt: null, lastDeliveredAt: null });

      // Y una respuesta leída cuenta como entregada.
      await msg("m9", "cv_live_", "out", "read", "operator", "2026-10-03T12:30:00Z");
      const later = await getConnectionEvidence(org, new Date("2026-10-03T12:00:00Z"));
      expect(later.lastDeliveredAt?.toISOString()).toBe("2026-10-03T12:30:00.000Z");
      expect(later.lastInboundAt).toBeNull();
    },
    30_000,
  );
});

import { beforeAll, describe, expect, it } from "vitest";
import type { getSql } from "@/lib/db";

type Sql = ReturnType<typeof getSql>;

/**
 * Pruebas contra Postgres DE VERDAD (opcionales — se saltan sin
 * `REALDB_TEST_DATABASE_URL`): item 2 de fix-27b depende del ORDEN real de
 * una consulta (`ASC` contra `DESC`), algo que un `getDb()` mockeado no
 * puede probar.
 *
 *   REALDB_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:PUERTO/db \
 *     pnpm exec vitest run tests/unit/nea-cursor-realdb.test.ts
 *
 * La base debe estar migrada (`pnpm db:migrate` o `node scripts/migrate.mjs`
 * contra ella) antes de correr esto.
 *
 * Item 1 (el 2xx-eco de un reintento) se prueba con `getDb()` mockeado en
 * `tests/unit/nea-turn-retry.test.ts` — rápido y sin dependencias externas,
 * pero también se corrió una vez a mano contra Postgres real (con
 * `timezone=UTC`) para confirmar el mecanismo de verdad; el resultado va en
 * la descripción del PR.
 */

const REALDB_URL = process.env.REALDB_TEST_DATABASE_URL;
const describeReal = REALDB_URL ? describe : describe.skip;

describeReal("real Postgres — fix-27b item 2: límite de pendientes", () => {
  beforeAll(() => {
    Object.assign(process.env, {
      DATABASE_URL: REALDB_URL,
      APP_BASE_URL: "http://localhost:3999",
      BETTER_AUTH_SECRET: "x".repeat(32),
      ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
      META_WEBHOOK_VERIFY_TOKEN: "verifytoken",
      BOT_API_KEY: "k".repeat(24),
    });
  });

  async function seed(sql: Sql, suffix: string) {
    const org = `org_r27b_${suffix}`;
    const ct = `ct_r27b_${suffix}`;
    const cv = `cv_r27b_${suffix}`;
    await sql`delete from organization where id = ${org}`;
    await sql`insert into organization (id, name, slug, created_at) values (${org}, ${org}, ${org}, now())`;
    await sql`insert into contact (id, organization_id, wa_identity, phone, name) values (${ct}, ${org}, ${"52155900" + suffix.length}, null, 'Lead')`;
    await sql`insert into conversation (id, organization_id, contact_id, ai_enabled, last_inbound_at) values (${cv}, ${org}, ${ct}, true, now())`;
    return { org, ct, cv };
  }
  async function inbound(sql: Sql, s: { org: string; cv: string }, id: string, text: string) {
    await sql`insert into message (id, organization_id, conversation_id, direction, type, text, status) values (${id}, ${s.org}, ${s.cv}, 'in', 'text', ${text}, 'delivered')`;
  }

  it(
    "más de 10 pendientes → toma los 10 MÁS VIEJOS (nunca los descarta), los que sobran esperan el próximo turno",
    async () => {
      const { getSql } = await import("@/lib/db");
      const { buildHistoryAndPending } = await import("@/server/ai/nea-history");
      const sql = getSql();
      const s = await seed(sql, "oldest");

      const ids: string[] = [];
      for (let i = 0; i < 15; i++) {
        const id = `msg_r27b_oldest_${String(i).padStart(2, "0")}`;
        ids.push(id);
        await inbound(sql, s, id, `mensaje ${i}`);
        await new Promise((r) => setTimeout(r, 10));
      }

      const result = await buildHistoryAndPending({ organizationId: s.org, conversationId: s.cv, now: new Date() });
      expect(result!.pendingIds).toEqual(ids.slice(0, 10));

      const maxAtRows = await sql`select max(created_at) as "maxAt" from message where id = ANY(${ids.slice(0, 10)})`;
      const maxAt = (maxAtRows[0] as { maxAt: Date }).maxAt;
      await sql`update conversation set agent_cursor_at = ${maxAt} where id = ${s.cv}`;

      const nextTurn = await buildHistoryAndPending({ organizationId: s.org, conversationId: s.cv, now: new Date() });
      expect(nextTurn!.pendingIds).toEqual(ids.slice(10));
    },
    30_000
  );
});

import { beforeAll, describe, expect, it } from "vitest";
import type { getSql } from "@/lib/db";

type Sql = ReturnType<typeof getSql>;

/**
 * `sweepFollowups` contra Postgres DE VERDAD (opcional — se salta sin
 * `REALDB_TEST_DATABASE_URL`): la elegibilidad del seguimiento automático
 * vive entera en una consulta SQL (LATERAL + varios NOT EXISTS) que un
 * `getDb()` mockeado no puede probar.
 *
 *   REALDB_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:PUERTO/db \
 *     pnpm exec vitest run tests/unit/followup-sweep-realdb.test.ts
 *
 * La base debe estar migrada antes (`MIGRATIONS_DIR=$PWD/drizzle
 * DATABASE_URL=… node scripts/migrate.mjs`) y correr con `timezone=UTC`.
 */

const REALDB_URL = process.env.REALDB_TEST_DATABASE_URL;
const describeReal = REALDB_URL ? describe : describe.skip;

const ORG = "org_fu_sweep";
const ORG_OFF = "org_fu_sweep_off";

describeReal("real Postgres — seguimiento automático: quién recibe el empujón", () => {
  beforeAll(() => {
    Object.assign(process.env, {
      DATABASE_URL: REALDB_URL,
      APP_BASE_URL: "http://localhost:3999",
      BETTER_AUTH_SECRET: "x".repeat(32),
      ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
      META_WEBHOOK_VERIFY_TOKEN: "verifytoken",
      BOT_API_KEY: "k".repeat(24),
      NEA_DISPATCH_URL: "http://nea-agent:8000/dispatch",
    });
  });

  type Case = {
    /** Minutos atrás del último entrante del lead. */
    inboundMinAgo: number;
    /** Qué quedó DESPUÉS del entrante, en orden. */
    after: { origin: "ai" | "manual"; status?: string; minAgo: number; direction?: "out" | "in" }[];
    conv?: { aiEnabled?: boolean; handoff?: boolean; isTest?: boolean };
    booking?: "agendada" | "cancelada";
    stage?: "open" | "lost";
    org?: string;
  };

  const CASES: Record<string, Case> = {
    elegible: { inboundMinAgo: 300, after: [{ origin: "ai", minAgo: 299 }] },
    leadHabloUltimo: { inboundMinAgo: 300, after: [{ origin: "ai", minAgo: 299 }, { origin: "ai", minAgo: 290, direction: "in" }] },
    humanoHabloUltimo: { inboundMinAgo: 300, after: [{ origin: "ai", minAgo: 299 }, { origin: "manual", minAgo: 280 }] },
    menosDe4h: { inboundMinAgo: 120, after: [{ origin: "ai", minAgo: 119 }] },
    ventanaPorCerrar: { inboundMinAgo: 23 * 60 + 45, after: [{ origin: "ai", minAgo: 23 * 60 + 44 }] },
    iaApagada: { inboundMinAgo: 300, after: [{ origin: "ai", minAgo: 299 }], conv: { aiEnabled: false } },
    enHandoff: { inboundMinAgo: 300, after: [{ origin: "ai", minAgo: 299 }], conv: { handoff: true } },
    deLaboratorio: { inboundMinAgo: 300, after: [{ origin: "ai", minAgo: 299 }], conv: { isTest: true } },
    conCita: { inboundMinAgo: 300, after: [{ origin: "ai", minAgo: 299 }], booking: "agendada" },
    citaCancelada: { inboundMinAgo: 300, after: [{ origin: "ai", minAgo: 299 }], booking: "cancelada" },
    leadPerdido: { inboundMinAgo: 300, after: [{ origin: "ai", minAgo: 299 }], stage: "lost" },
    leadAbierto: { inboundMinAgo: 300, after: [{ origin: "ai", minAgo: 299 }], stage: "open" },
    ultimoAiFallido: { inboundMinAgo: 300, after: [{ origin: "ai", minAgo: 299 }, { origin: "ai", minAgo: 200, status: "failed" }] },
    perfilApagado: { inboundMinAgo: 300, after: [{ origin: "ai", minAgo: 299 }], org: ORG_OFF },
  };
  const ELEGIBLES = ["elegible", "citaCancelada", "leadAbierto", "ultimoAiFallido"];

  async function seedOrg(sql: Sql, org: string, enabled: boolean) {
    await sql`delete from organization where id = ${org}`;
    await sql`insert into organization (id, name, slug, created_at) values (${org}, ${org}, ${org}, now())`;
    await sql`insert into agent_profile (id, organization_id, enabled) values (${"agp_" + org}, ${org}, ${enabled})`;
    await sql`insert into pipeline_stage (id, organization_id, name, position, kind) values
      (${"st_open_" + org}, ${org}, 'Nuevo', 0, 'open'), (${"st_lost_" + org}, ${org}, 'Perdido', 9, 'lost')`;
  }

  async function seedCase(sql: Sql, name: string, c: Case, i: number) {
    const org = c.org ?? ORG;
    const ct = `ct_fu_${name}`;
    const cv = `cv_fu_${name}`;
    await sql`insert into contact (id, organization_id, wa_identity, name) values (${ct}, ${org}, ${"5215500000" + String(i).padStart(2, "0")}, ${name})`;
    await sql`insert into conversation (id, organization_id, contact_id, ai_enabled, is_test, handoff_at, last_inbound_at)
      values (${cv}, ${org}, ${ct}, ${c.conv?.aiEnabled ?? true}, ${c.conv?.isTest ?? false},
              ${c.conv?.handoff ? sql`now() - interval '1 hour'` : null},
              now() - make_interval(mins => ${c.inboundMinAgo}))`;
    await sql`insert into message (id, organization_id, conversation_id, wa_message_id, direction, type, text, status, origin, created_at)
      values (${`msg_fu_${name}_in`}, ${org}, ${cv}, ${`wamid.${name}.in`}, 'in', 'text', 'Quiero más información', 'delivered', 'operator',
              now() - make_interval(mins => ${c.inboundMinAgo}))`;
    for (const [j, m] of c.after.entries()) {
      const direction = m.direction ?? "out";
      await sql`insert into message (id, organization_id, conversation_id, wa_message_id, direction, type, text, status, origin, created_at)
        values (${`msg_fu_${name}_${j}`}, ${org}, ${cv}, ${`wamid.${name}.${j}`}, ${direction}, 'text', 'texto',
                ${m.status ?? "delivered"}, ${direction === "in" ? "operator" : m.origin}, now() - make_interval(mins => ${m.minAgo}))`;
      if (direction === "in") {
        await sql`update conversation set last_inbound_at = now() - make_interval(mins => ${m.minAgo}) where id = ${cv}`;
      }
    }
    if (c.booking) {
      await sql`insert into booking (id, organization_id, conversation_id, contact_id, scheduled_at, duration_minutes, status)
        values (${`bk_fu_${name}`}, ${org}, ${cv}, ${ct}, now() + interval '2 days', 30, ${c.booking})`;
    }
    if (c.stage) {
      await sql`insert into lead (id, organization_id, contact_id, stage_id)
        values (${`ld_fu_${name}`}, ${org}, ${ct}, ${`st_${c.stage}_${org}`})`;
    }
  }

  it(
    "un sweep encola exactamente a los elegibles, y el segundo no repite a nadie",
    async () => {
      const { getSql } = await import("@/lib/db");
      const { sweepFollowups, followupJobId } = await import("@/server/ai/followup");
      const sql = getSql();
      await seedOrg(sql, ORG, true);
      await seedOrg(sql, ORG_OFF, false);
      let i = 0;
      for (const [name, c] of Object.entries(CASES)) await seedCase(sql, name, c, i++);

      const first = await sweepFollowups(new Date());
      const rows = await sql`select id, status from agent_job where organization_id in (${ORG}, ${ORG_OFF}) order by id`;
      const jobs = rows.map((r) => (r as { id: string }).id);
      const expected = ELEGIBLES.map((n) => followupJobId(`cv_fu_${n}`)).sort();

      expect(jobs).toEqual(expected);
      expect(first).toBe(ELEGIBLES.length);
      expect(rows.every((r) => (r as { status: string }).status === "queued")).toBe(true);

      // A lo sumo UNO por conversación en toda su vida: aunque el job ya
      // terminó, su id determinista sigue ahí y el sweep no lo repite.
      await sql`update agent_job set status = 'done' where organization_id = ${ORG}`;
      expect(await sweepFollowups(new Date())).toBe(0);
    },
    30_000
  );
});

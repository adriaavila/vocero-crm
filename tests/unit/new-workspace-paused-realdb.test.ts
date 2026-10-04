import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Pruebas contra Postgres DE VERDAD (opcionales, se saltan sin
 * `REALDB_TEST_DATABASE_URL`): todo negocio nuevo nace con el agente en pausa,
 * lo cree el alta pública o un admin de allok, y los negocios que ya existían
 * siguen como estaban.
 *
 *   REALDB_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:PUERTO/db \
 *     pnpm exec vitest run tests/unit/new-workspace-paused-realdb.test.ts
 *
 * La base debe estar migrada (`node scripts/migrate.mjs`) antes de correr esto.
 */

const REALDB_URL = process.env.REALDB_TEST_DATABASE_URL;
const describeReal = REALDB_URL ? describe : describe.skip;

describeReal("real Postgres, negocio nuevo con el agente en pausa", () => {
  const suffix = Math.random().toString(36).slice(2, 8);
  const ids = {
    existingOrg: `org_pause_old_${suffix}`,
    existingUser: `usr_pause_old_${suffix}`,
    adminUser: `usr_pause_adm_${suffix}`,
    selfUser: `usr_pause_self_${suffix}`,
  };

  beforeAll(() => {
    Object.assign(process.env, {
      DATABASE_URL: REALDB_URL,
      APP_BASE_URL: "http://localhost:3999",
      BETTER_AUTH_SECRET: "x".repeat(32),
      ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
      META_WEBHOOK_VERIFY_TOKEN: "verifytoken",
      ALLOK_SAAS_MODE: "true",
    });
    delete process.env.BRAND;
  });

  afterAll(async () => {
    const { getSql } = await import("@/lib/db");
    const sql = getSql();
    await sql`delete from organization where id = ${ids.existingOrg} or id in (
      select organization_id from member where user_id in (${ids.adminUser}, ${ids.selfUser}))`;
    await sql`delete from "user" where id in (${ids.existingUser}, ${ids.adminUser}, ${ids.selfUser})`;
    delete process.env.ALLOK_SAAS_MODE;
  });

  async function seedUser(id: string) {
    const { getSql } = await import("@/lib/db");
    await getSql()`insert into "user" (id, name, email) values (${id}, ${id}, ${id + "@example.test"})`;
  }

  async function profileOf(userId: string) {
    const { getSql } = await import("@/lib/db");
    const rows = await getSql()`
      select p.enabled, p.name, p.greeting, p.business_timezone as tz, p.response_mode as mode
      from agent_profile p join member m on m.organization_id = p.organization_id
      where m.user_id = ${userId}`;
    return rows[0] as { enabled: boolean; name: string; greeting: string; tz: string; mode: string };
  }

  it(
    "alta de admin y alta de autoservicio nacen en pausa, y el negocio de antes no cambia",
    async () => {
      const { getSql } = await import("@/lib/db");
      const sql = getSql();
      // Un negocio que ya existía, con el agente encendido y el nombre de siempre.
      await seedUser(ids.existingUser);
      await sql`insert into organization (id, name, slug, created_at) values (${ids.existingOrg}, 'Viejo', ${"viejo-" + suffix}, now())`;
      await sql`insert into agent_profile (id, organization_id, enabled, name) values (${"ap_" + suffix}, ${ids.existingOrg}, true, 'Rei')`;

      const { onUserCreated } = await import("@/server/auth/on-signup");
      await seedUser(ids.adminUser);
      await onUserCreated(ids.adminUser, `Panadería Admin ${suffix}`, { timezone: "America/Caracas" });
      await seedUser(ids.selfUser);
      await onUserCreated(ids.selfUser, `Panadería Auto ${suffix}`, {
        timezone: "America/Bogota",
        selfServeTrial: true,
      });

      const admin = await profileOf(ids.adminUser);
      const self = await profileOf(ids.selfUser);
      expect(admin).toMatchObject({ enabled: false, name: "Asistente", tz: "America/Caracas", mode: "outside_hours" });
      expect(self).toMatchObject({ enabled: false, name: "Asistente", tz: "America/Bogota" });
      expect(admin.greeting).not.toContain("Rei");

      const old = (await sql`select enabled, name from agent_profile where organization_id = ${ids.existingOrg}`)[0];
      expect(old).toMatchObject({ enabled: true, name: "Rei" });
    },
    30_000,
  );
});

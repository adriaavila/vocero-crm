/**
 * Camino real de `hasEverActivated` / `getReadiness` contra Postgres:
 *   REALDB_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:PUERTO/db pnpm exec vitest run tests/unit/activado-realdb.test.ts
 * (la base ya migrada; escribe sus propias filas y las borra).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";

const URL_ = process.env.REALDB_TEST_DATABASE_URL;
const d = URL_ ? describe : describe.skip;

d("hasEverActivated (BD real)", () => {
  const sql = postgres(URL_ ?? "postgres://x", { max: 1, onnotice: () => {} });
  const ids: string[] = [];
  beforeAll(async () => {
    Object.assign(process.env, {
      DATABASE_URL: URL_,
      APP_BASE_URL: "http://localhost:3999",
      BETTER_AUTH_SECRET: "x".repeat(32),
      ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
      META_WEBHOOK_VERIFY_TOKEN: "activado-verify-token",
    });
    const { resetEnvCacheForTests } = await import("@/lib/env");
    resetEnvCacheForTests();
  });
  afterAll(async () => {
    for (const id of ids) await sql`delete from organization where id = ${id}`;
    await sql.end();
  });

  async function org(meta: object, createdAt: string) {
    const id = `act_${Math.random().toString(36).slice(2, 10)}`;
    ids.push(id);
    await sql`insert into organization (id, name, slug, metadata, created_at) values (${id}, ${id}, ${id}, ${JSON.stringify(meta)}, ${createdAt})`;
    return id;
  }

  it("encendido sin marca: se escribe activatedAt y billing queda intacto", async () => {
    const { hasEverActivated } = await import("@/server/agencia/activado");
    const billing = { plan: "pro", status: "trialing", history: [] };
    const id = await org({ allok: { billing, origen: { landing: "/x" } } }, "2026-11-12T00:00:00Z");
    expect(await hasEverActivated(id, true)).toBe(true);
    const [row] = await sql`select metadata from organization where id = ${id}`;
    const m = JSON.parse(row!.metadata);
    expect(typeof m.allok.activatedAt).toBe("string");
    expect(m.allok.billing).toEqual(billing);
    expect(m.allok.origen).toEqual({ landing: "/x" });
    const first = m.allok.activatedAt;
    await hasEverActivated(id, true);
    const [again] = await sql`select metadata from organization where id = ${id}`;
    expect(JSON.parse(again!.metadata).allok.activatedAt).toBe(first);
  });

  it("negocio nuevo con mensajes de IA de la demo sigue en alta; uno anterior al corte con IA real, no", async () => {
    const { hasEverActivated } = await import("@/server/agencia/activado");
    const seed = async (id: string, wamid: string) => {
      await sql`insert into contact (id, organization_id, wa_identity, name) values (${id + "c"}, ${id}, ${id}, 'x')`;
      await sql`insert into conversation (id, organization_id, contact_id, is_test) values (${id + "v"}, ${id}, ${id + "c"}, false)`;
      await sql`insert into message (id, organization_id, conversation_id, wa_message_id, direction, ai_generated, origin) values (${id + "m"}, ${id}, ${id + "v"}, ${wamid}, 'out', true, 'ai')`;
    };
    const nuevo = await org({ allok: {} }, "2026-11-12T00:00:00Z");
    await seed(nuevo, "wamid.demo.abc");
    expect(await hasEverActivated(nuevo, false)).toBe(false);
    const viejo = await org({ allok: {} }, "2026-09-01T00:00:00Z");
    await seed(viejo, "wamid.real.1");
    expect(await hasEverActivated(viejo, false)).toBe(true);
    const viejoDemo = await org({ allok: {} }, "2026-09-01T00:00:00Z");
    await seed(viejoDemo, "wamid.demo.zzz");
    expect(await hasEverActivated(viejoDemo, false)).toBe(false);
  });
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Contra Postgres DE VERDAD (opcional, se salta sin `REALDB_TEST_DATABASE_URL`):
 * el origen del alta se anota una sola vez (primer toque) y nunca toca
 * `allok.billing` ni otras claves de la metadata.
 *
 *   REALDB_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:PUERTO/db \
 *     pnpm exec vitest run tests/unit/origen-alta-realdb.test.ts
 */

const REALDB_URL = process.env.REALDB_TEST_DATABASE_URL;
const describeReal = REALDB_URL ? describe : describe.skip;

describeReal("real Postgres, origen del alta", () => {
  const suffix = Math.random().toString(36).slice(2, 8);
  const orgId = `org_origen_${suffix}`;
  const billing = { plan: "pro", status: "trialing", source: "self_serve_trial", currentPeriodEnd: "2026-10-12T00:00:00.000Z" };

  beforeAll(async () => {
    Object.assign(process.env, {
      DATABASE_URL: REALDB_URL,
      APP_BASE_URL: "http://localhost:3999",
      BETTER_AUTH_SECRET: "x".repeat(32),
      ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
      META_WEBHOOK_VERIFY_TOKEN: "verifytoken",
    });
    const { getSql } = await import("@/lib/db");
    await getSql()`insert into organization (id, name, slug, created_at, metadata)
      values (${orgId}, 'Origen', ${"origen-" + suffix}, now(), ${JSON.stringify({ otra: 1, allok: { billing, lifecycle: { x: 1 } } })})`;
  });

  afterAll(async () => {
    const { getSql } = await import("@/lib/db");
    await getSql()`delete from organization where id = ${orgId}`;
  });

  async function metadata() {
    const { getSql } = await import("@/lib/db");
    const rows = await getSql()`select metadata from organization where id = ${orgId}`;
    return JSON.parse(String(rows[0]?.metadata));
  }

  it("primer toque gana y billing queda intacto", async () => {
    const { guardarOrigen } = await import("@/server/agencia/origen-alta");
    expect(await guardarOrigen(orgId, { utm_source: "test", referrer: "https://l.facebook.com/x" })).toBe("guardado");
    let meta = await metadata();
    expect(meta.allok.origen).toMatchObject({ utm_source: "test", referrer: "l.facebook.com" });
    expect(typeof meta.allok.origen.at).toBe("string");
    expect(meta.allok.billing).toEqual(billing);
    expect(meta.allok.lifecycle).toEqual({ x: 1 });
    expect(meta.otra).toBe(1);

    expect(await guardarOrigen(orgId, { utm_source: "otra" })).toBe("ya_existia");
    meta = await metadata();
    expect(meta.allok.origen.utm_source).toBe("test");

    // Dos envíos a la vez sobre un negocio sin origen: uno solo escribe.
    const { getSql } = await import("@/lib/db");
    await getSql()`update organization set metadata = ${JSON.stringify({ allok: { billing } })} where id = ${orgId}`;
    const results = await Promise.all([guardarOrigen(orgId, { utm_source: "a" }), guardarOrigen(orgId, { utm_source: "b" })]);
    expect(results.filter((r) => r === "guardado")).toHaveLength(1);
    expect(results.filter((r) => r === "ya_existia")).toHaveLength(1);
    expect((await metadata()).allok.billing).toEqual(billing);
  });

  it("un negocio que no existe no se crea", async () => {
    const { guardarOrigen } = await import("@/server/agencia/origen-alta");
    expect(await guardarOrigen(`org_nadie_${suffix}`, { utm_source: "x" })).toBe("no_encontrado");
  });
});

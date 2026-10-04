import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

/**
 * `runTrialLifecycleOnce`: quién recibe cada correo, que salga una sola vez
 * (reclamo atómico), que un fallo de envío libere la marca, y que no haga nada
 * con el correo o el autoservicio apagados. La BD es un doble con el mismo
 * contrato que las tres consultas SQL del módulo.
 */

const NOW = new Date("2026-10-10T12:00:00Z");
const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

type Org = { id: string; slug: string; email: string; metadata: string };
let orgs: Org[] = [];
const marks = new Set<string>(); // `${orgId}:${key}`
const claimCalls: string[] = [];
const releaseCalls: string[] = [];

const dialect = new PgDialect();
vi.mock("@/lib/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db")>()),
  getDb: () => ({
    execute: async (query: Parameters<PgDialect["sqlToQuery"]>[0]) => {
      const { sql, params } = dialect.sqlToQuery(query);
      const strings = params.filter((p): p is string => typeof p === "string");
      const key = strings.find((p) => p === "trialEnding" || p === "trialEnded") ?? "";
      const id = strings.find((p) => p.startsWith("org_")) ?? "";
      if (sql.includes("select distinct on")) {
        return orgs.map((o) => ({ id: o.id, slug: o.slug, metadata: o.metadata, email: o.email, timezone: "America/Caracas" }));
      }
      if (sql.includes("jsonb_set")) {
        claimCalls.push(`${id}:${key}`);
        if (marks.has(`${id}:${key}`)) return [];
        marks.add(`${id}:${key}`);
        return [{ id }];
      }
      releaseCalls.push(`${id}:${key}`);
      marks.delete(`${id}:${key}`);
      return [];
    },
  }),
}));
const sendEmail = vi.fn();
vi.mock("@/server/agencia/email", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/agencia/email")>()),
  sendEmail: (message: unknown) => sendEmail(message),
}));

import { runTrialLifecycleOnce } from "@/server/agencia/trial-correos";

function trial(id: string, endsInMs: number, extra: Record<string, unknown> = {}): Org {
  return {
    id,
    slug: id.replace("org_", ""),
    email: `${id}@ejemplo.com`,
    metadata: JSON.stringify({
      allok: {
        billing: {
          plan: "pro",
          status: "trialing",
          source: "self_serve_trial",
          currentPeriodEnd: new Date(NOW.getTime() + endsInMs).toISOString(),
          ...extra,
        },
      },
    }),
  };
}

describe("runTrialLifecycleOnce", () => {
  beforeEach(() => {
    orgs = [];
    marks.clear();
    claimCalls.length = 0;
    releaseCalls.length = 0;
    sendEmail.mockReset().mockResolvedValue({ ok: true, id: "m1" });
    vi.stubEnv("ALLOK_SAAS_MODE", "true");
    vi.stubEnv("SAAS_SELF_SERVE", "true");
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("EMAIL_FROM", "allok <no-reply@allok.fun>");
    vi.stubEnv("APP_BASE_URL", "http://localhost:3000");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("sends «termina pronto» to a trial with <=48 h left and «terminó» to a recent expiry, nobody else", async () => {
    orgs = [
      trial("org_mid", 5 * DAY), // faltan 5 días: nada
      trial("org_ending", 30 * HOUR),
      trial("org_ended", -2 * DAY),
      trial("org_longgone", -20 * DAY), // venció hace semanas: no se le escribe
      trial("org_paid", 30 * HOUR, { subscriptionId: "sub_1", status: "active" }),
    ];

    const result = await runTrialLifecycleOnce(NOW);

    expect(result).toEqual({ ending: 1, ended: 1, failed: 0 });
    const sent = sendEmail.mock.calls.map(([m]) => m as { to: string; subject: string; text: string });
    expect(sent.map((m) => m.to).sort()).toEqual(["org_ended@ejemplo.com", "org_ending@ejemplo.com"]);
    expect(sent.find((m) => m.to === "org_ending@ejemplo.com")?.subject).toMatch(/termina/);
    expect(sent.find((m) => m.to === "org_ended@ejemplo.com")?.subject).toMatch(/terminó/);
    expect(sent[0]?.text).toContain(".localhost:3000/settings/billing");
  });

  it("claims once: a second pass sends nothing", async () => {
    orgs = [trial("org_ending", 30 * HOUR)];

    await runTrialLifecycleOnce(NOW);
    const second = await runTrialLifecycleOnce(NOW);

    expect(second).toEqual({ ending: 0, ended: 0, failed: 0 });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(claimCalls).toEqual(["org_ending:trialEnding", "org_ending:trialEnding"]);
  });

  it("releases the claim when the send fails, so the next pass retries", async () => {
    orgs = [trial("org_ending", 30 * HOUR)];
    sendEmail.mockResolvedValueOnce({ ok: false, reason: "unreachable" });

    expect(await runTrialLifecycleOnce(NOW)).toEqual({ ending: 0, ended: 0, failed: 1 });
    expect(releaseCalls).toEqual(["org_ending:trialEnding"]);

    expect(await runTrialLifecycleOnce(NOW)).toEqual({ ending: 1, ended: 0, failed: 0 });
    expect(sendEmail).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["email is off", { RESEND_API_KEY: "" }],
    ["EMAIL_FROM is missing", { EMAIL_FROM: "" }],
    ["SAAS_SELF_SERVE is off", { SAAS_SELF_SERVE: "false" }],
    ["SaaS mode is off", { ALLOK_SAAS_MODE: "" }],
  ])("does nothing, not even claiming, when %s", async (_name, env) => {
    for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
    orgs = [trial("org_ending", 30 * HOUR), trial("org_ended", -2 * DAY)];

    expect(await runTrialLifecycleOnce(NOW)).toEqual({ ending: 0, ended: 0, failed: 0 });
    expect(claimCalls).toEqual([]);
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

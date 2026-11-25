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
      const key = strings.find((p) => ["trialEnding", "trialEnded", "setupDay1", "setupDay3"].includes(p)) ?? "";
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

const setupDone = new Map<string, Record<string, boolean>>(); // orgId → pasos hechos; sin entrada = agente ya activo
const progressCalls: string[] = [];
vi.mock("@/server/agencia/setup-progress", async () => {
  const { SETUP_STEP_ORDER, SETUP_STEP_META } = await import("@/lib/setup-steps");
  return {
    getSetupProgress: async (id: string) => {
      progressCalls.push(id);
      const done = setupDone.get(id) ?? { negocio: true, probar: true, whatsapp: true, activar: true };
      const steps = SETUP_STEP_ORDER.map((key) => ({ key, ...SETUP_STEP_META[key], done: Boolean(done[key]) }));
      return { steps, current: steps.find((s) => !s.done)?.key ?? null, active: !done.activar };
    },
  };
});

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
    // `billingFromMetadata` lee el reloj real para dar por vencida una prueba.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    setupDone.clear();
    progressCalls.length = 0;
    sendEmail.mockReset().mockResolvedValue({ ok: true, id: "m1" });
    vi.stubEnv("ALLOK_SAAS_MODE", "true");
    vi.stubEnv("SAAS_SELF_SERVE", "true");
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("EMAIL_FROM", "allok <no-reply@allok.fun>");
    vi.stubEnv("APP_BASE_URL", "http://localhost:3000");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("sends «termina pronto» to a trial with <=48 h left and «terminó» to a recent expiry, nobody else", async () => {
    orgs = [
      trial("org_mid", 5 * DAY), // faltan 5 días: nada
      trial("org_ending", 30 * HOUR),
      trial("org_ended", -2 * DAY),
      trial("org_longgone", -20 * DAY), // venció hace semanas: no se le escribe
      trial("org_paid", 30 * HOUR, { subscriptionId: "sub_1", status: "active" }),
    ];

    const result = await runTrialLifecycleOnce(NOW);

    expect(result).toEqual({ setup: 0, ending: 1, ended: 1, failed: 0 });
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

    expect(second).toEqual({ setup: 0, ending: 0, ended: 0, failed: 0 });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(claimCalls).toEqual(["org_ending:trialEnding", "org_ending:trialEnding"]);
  });

  it("releases the claim when the send fails, so the next pass retries", async () => {
    orgs = [trial("org_ending", 30 * HOUR)];
    sendEmail.mockResolvedValueOnce({ ok: false, reason: "unreachable" });

    expect(await runTrialLifecycleOnce(NOW)).toEqual({ setup: 0, ending: 0, ended: 0, failed: 1 });
    expect(releaseCalls).toEqual(["org_ending:trialEnding"]);

    expect(await runTrialLifecycleOnce(NOW)).toEqual({ setup: 0, ending: 1, ended: 0, failed: 0 });
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

    expect(await runTrialLifecycleOnce(NOW)).toEqual({ setup: 0, ending: 0, ended: 0, failed: 0 });
    expect(claimCalls).toEqual([]);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  describe("«te falta un paso»", () => {
    it("the day after signup, sends the next step and its link to a trial whose agent is not on yet", async () => {
      orgs = [trial("org_new", 6 * DAY - 2 * HOUR), trial("org_fresh", 7 * DAY - 10 * HOUR)];
      setupDone.set("org_new", { negocio: true });
      setupDone.set("org_fresh", {});

      expect(await runTrialLifecycleOnce(NOW)).toEqual({ setup: 1, ending: 0, ended: 0, failed: 0 });
      const [mail] = sendEmail.mock.calls.map(([m]) => m as { to: string; subject: string; text: string; html: string });
      expect(mail?.to).toBe("org_new@ejemplo.com");
      expect(mail?.subject).toBe("Tu agente está a 3 pasos de contestar en tu WhatsApp");
      expect(mail?.text).toContain("✓ Tu negocio");
      expect(mail?.text).toContain("Lo que sigue: Probar.");
      expect(mail?.text).toContain("new.localhost:3000/lab");
      expect(mail?.html).toContain("new.localhost:3000/lab");
      expect(progressCalls).toEqual(["org_new"]); // 10 h después del alta todavía no se mira
    });

    it("mid-trial, sends one reminder with the days left, and only once", async () => {
      orgs = [trial("org_mid", 3 * DAY)];
      setupDone.set("org_mid", { negocio: true, probar: true, whatsapp: true });

      await runTrialLifecycleOnce(NOW);
      await runTrialLifecycleOnce(NOW);

      expect(sendEmail).toHaveBeenCalledTimes(1);
      const mail = sendEmail.mock.calls[0]?.[0] as { subject: string; text: string };
      expect(mail.subject).toMatch(/todavía no contesta: te falta un paso/);
      expect(mail.text).toContain("Te quedan 3 días de prueba");
      expect(mail.text).toContain("mid.localhost:3000/agent#activar");
      expect(claimCalls).toEqual(["org_mid:setupDay3", "org_mid:setupDay3"]);
    });

    it("marks it without writing when the agent is already answering", async () => {
      orgs = [trial("org_live", 6 * DAY - 2 * HOUR)];

      expect(await runTrialLifecycleOnce(NOW)).toEqual({ setup: 0, ending: 0, ended: 0, failed: 0 });
      expect(sendEmail).not.toHaveBeenCalled();
      expect(claimCalls).toEqual(["org_live:setupDay1"]);
    });

    it("skips the readiness lookup once the org metadata already carries the mark", async () => {
      orgs = [trial("org_seen", 6 * DAY - 2 * HOUR)];
      orgs[0]!.metadata = JSON.stringify({ ...JSON.parse(orgs[0]!.metadata), allok: { ...JSON.parse(orgs[0]!.metadata).allok, lifecycle: { setupDay1: NOW.toISOString() } } });

      await runTrialLifecycleOnce(NOW);

      expect(progressCalls).toEqual([]);
      expect(sendEmail).not.toHaveBeenCalled();
    });

    it("releases the mark when the send fails", async () => {
      orgs = [trial("org_new", 6 * DAY - 2 * HOUR)];
      setupDone.set("org_new", {});
      sendEmail.mockResolvedValueOnce({ ok: false, reason: "rejected" });

      expect(await runTrialLifecycleOnce(NOW)).toEqual({ setup: 0, ending: 0, ended: 0, failed: 1 });
      expect(releaseCalls).toEqual(["org_new:setupDay1"]);
    });
  });
});

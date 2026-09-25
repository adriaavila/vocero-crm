import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `maybeRunAgentTurn` — el punto de enganche tras la ingesta real.
 *
 * El bug que esta suite cubre: antes, `BOT_API_KEY` configurada hacía que
 * este punto se quedara callado (el cerebro externo escuchaba su propia
 * suscripción al webhook). Ahora el CRM SIEMPRE despacha — a Nea si está
 * configurada, a Rei si no — y en SaaS siempre encola porque las claves
 * pueden vivir por organización (solo el turno mismo las conoce).
 */

const { scheduleAgentTurn } = vi.hoisted(() => ({ scheduleAgentTurn: vi.fn() }));
vi.mock("@/server/ai/pipeline", () => ({ scheduleAgentTurn }));

import { maybeRunAgentTurn } from "@/server/ai/trigger";

describe("maybeRunAgentTurn", () => {
  beforeEach(() => scheduleAgentTurn.mockClear());
  afterEach(() => vi.unstubAllEnvs());

  it("instancia dedicada + BOT_API_KEY y NEA_DISPATCH_URL (Nea) → encola el turno", async () => {
    vi.stubEnv("ALLOK_SAAS_MODE", "");
    vi.stubEnv("BOT_API_KEY", "clave-compartida-con-nea-larga");
    vi.stubEnv("NEA_DISPATCH_URL", "http://nea-agent:8000/dispatch");
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("OPENROUTER_API_TOKEN", "");

    await maybeRunAgentTurn("conv_1", "org_1");

    expect(scheduleAgentTurn).toHaveBeenCalledWith("conv_1");
  });

  it("instancia dedicada + solo BOT_API_KEY (sin NEA_DISPATCH_URL) con IA propia → Rei encola el turno", async () => {
    vi.stubEnv("ALLOK_SAAS_MODE", "");
    vi.stubEnv("BOT_API_KEY", "clave-compartida-con-nea-larga");
    vi.stubEnv("NEA_DISPATCH_URL", "");
    vi.stubEnv("OPENAI_API_KEY", "token-test");

    await maybeRunAgentTurn("conv_1", "org_1");

    expect(scheduleAgentTurn).toHaveBeenCalledWith("conv_1");
  });

  it("instancia dedicada sin ningún cerebro (ni Nea ni IA propia) → no encola nada", async () => {
    vi.stubEnv("ALLOK_SAAS_MODE", "");
    vi.stubEnv("BOT_API_KEY", "");
    vi.stubEnv("NEA_DISPATCH_URL", "");
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("OPENROUTER_API_TOKEN", "");

    await maybeRunAgentTurn("conv_1", "org_1");

    expect(scheduleAgentTurn).not.toHaveBeenCalled();
  });

  it("SaaS SIEMPRE encola, aunque el proceso no vea ninguna clave (el turno resuelve por-org)", async () => {
    vi.stubEnv("ALLOK_SAAS_MODE", "true");
    vi.stubEnv("BOT_API_KEY", "");
    vi.stubEnv("NEA_DISPATCH_URL", "");
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("OPENROUTER_API_TOKEN", "");

    await maybeRunAgentTurn("conv_1", "org_1");

    expect(scheduleAgentTurn).toHaveBeenCalledWith("conv_1");
  });
});

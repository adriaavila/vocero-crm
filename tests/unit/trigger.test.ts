import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `maybeRunAgentTurn` — el punto de enganche tras la ingesta real.
 *
 * CRÍTICO: desplegar esta migración SIN fijar `NEA_DISPATCH_URL` tiene que
 * ser un no-op total. `BOT_API_KEY` sola sigue significando EXACTAMENTE lo
 * mismo que en `main`: un cerebro externo LEGADO al mando, que escucha su
 * propia suscripción al webhook de Meta — este punto se queda callado (nada
 * de Rei respondiendo también, nada de un `agent_job` para el negocio
 * heredado en SaaS). Solo con `NEA_DISPATCH_URL` + `BOT_API_KEY` (Nea) el CRM
 * empieza a encolar y despachar explícitamente.
 */

const { scheduleAgentTurn } = vi.hoisted(() => ({ scheduleAgentTurn: vi.fn() }));
vi.mock("@/server/ai/pipeline", () => ({ scheduleAgentTurn }));

const { resolveLegacyOrganizationId } = vi.hoisted(() => ({
  resolveLegacyOrganizationId: vi.fn(async () => "org_principal"),
}));
vi.mock("@/server/auth/on-signup", () => ({ resolveLegacyOrganizationId }));

import { maybeRunAgentTurn } from "@/server/ai/trigger";

describe("maybeRunAgentTurn", () => {
  beforeEach(() => {
    scheduleAgentTurn.mockClear();
    resolveLegacyOrganizationId.mockClear();
  });
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

  it("NO-OP crítico: instancia dedicada + solo BOT_API_KEY (sin NEA_DISPATCH_URL) → EXACTAMENTE como main, no encola nada (el bot legado responde por su cuenta)", async () => {
    vi.stubEnv("ALLOK_SAAS_MODE", "");
    vi.stubEnv("BOT_API_KEY", "clave-compartida-con-nea-larga");
    vi.stubEnv("NEA_DISPATCH_URL", "");
    // Aunque HAYA una clave de IA propia: main tampoco arrancaba a Rei aquí.
    vi.stubEnv("OPENAI_API_KEY", "token-test");

    await maybeRunAgentTurn("conv_1", "org_1");

    expect(scheduleAgentTurn).not.toHaveBeenCalled();
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

  it("instancia dedicada sin cerebro externo pero con IA propia → Rei encola el turno", async () => {
    vi.stubEnv("ALLOK_SAAS_MODE", "");
    vi.stubEnv("BOT_API_KEY", "");
    vi.stubEnv("NEA_DISPATCH_URL", "");
    vi.stubEnv("OPENAI_API_KEY", "token-test");

    await maybeRunAgentTurn("conv_1", "org_1");

    expect(scheduleAgentTurn).toHaveBeenCalledWith("conv_1");
  });

  it("NO-OP crítico: SaaS + solo BOT_API_KEY (sin NEA_DISPATCH_URL) + negocio heredado (principal) → EXACTAMENTE como main, sin agent_job", async () => {
    vi.stubEnv("ALLOK_SAAS_MODE", "true");
    vi.stubEnv("BOT_API_KEY", "clave-compartida-con-nea-larga");
    vi.stubEnv("NEA_DISPATCH_URL", "");
    resolveLegacyOrganizationId.mockResolvedValue("org_principal");

    await maybeRunAgentTurn("conv_1", "org_principal");

    expect(scheduleAgentTurn).not.toHaveBeenCalled();
  });

  it("SaaS + solo BOT_API_KEY (sin NEA_DISPATCH_URL) + OTRO negocio (no el heredado) → sí encola (como siempre en SaaS)", async () => {
    vi.stubEnv("ALLOK_SAAS_MODE", "true");
    vi.stubEnv("BOT_API_KEY", "clave-compartida-con-nea-larga");
    vi.stubEnv("NEA_DISPATCH_URL", "");
    resolveLegacyOrganizationId.mockResolvedValue("org_principal");

    await maybeRunAgentTurn("conv_1", "org_otro_negocio");

    expect(scheduleAgentTurn).toHaveBeenCalledWith("conv_1");
  });

  it("SaaS SIEMPRE encola sin ningún cerebro externo (el turno resuelve la IA por-org)", async () => {
    vi.stubEnv("ALLOK_SAAS_MODE", "true");
    vi.stubEnv("BOT_API_KEY", "");
    vi.stubEnv("NEA_DISPATCH_URL", "");
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("OPENROUTER_API_TOKEN", "");

    await maybeRunAgentTurn("conv_1", "org_1");

    expect(scheduleAgentTurn).toHaveBeenCalledWith("conv_1");
    expect(resolveLegacyOrganizationId).not.toHaveBeenCalled();
  });

  it("SaaS + Nea (NEA_DISPATCH_URL) → encola para CUALQUIER negocio, incluido el heredado", async () => {
    vi.stubEnv("ALLOK_SAAS_MODE", "true");
    vi.stubEnv("BOT_API_KEY", "clave-compartida-con-nea-larga");
    vi.stubEnv("NEA_DISPATCH_URL", "http://nea-agent:8000/dispatch");
    resolveLegacyOrganizationId.mockResolvedValue("org_principal");

    await maybeRunAgentTurn("conv_1", "org_principal");

    expect(scheduleAgentTurn).toHaveBeenCalledWith("conv_1");
    // Ni siquiera se pregunta quién es el negocio heredado: Nea despacha a todos.
    expect(resolveLegacyOrganizationId).not.toHaveBeenCalled();
  });
});

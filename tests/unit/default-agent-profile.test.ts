import { describe, expect, it } from "vitest";
import {
  DEFAULT_AGENT_TEMPLATE_VERSION,
  defaultAgentProfile,
} from "@/server/agent/default-profile";

describe("plantilla SaaS del agente", () => {
  it("crea el perfil base Rei activo y público", () => {
    const profile = defaultAgentProfile();
    expect(DEFAULT_AGENT_TEMPLATE_VERSION).toBe("saas-v1");
    expect(profile).toMatchObject({
      name: "Rei",
      enabled: true,
      allowlistEnabled: false,
      activationEnabled: false,
      aiProvider: "openrouter",
    });
    expect(profile.instructions).toContain("Nunca inventes");
    expect(profile.greeting).toContain("Rei");
  });

  it("devuelve objetos independientes para cada alta", () => {
    const first = defaultAgentProfile();
    const second = defaultAgentProfile();
    expect(first).not.toBe(second);
    expect(first.activationMessages).not.toBe(second.activationMessages);
    expect(first.allowedWaIds).not.toBe(second.allowedWaIds);
  });
});

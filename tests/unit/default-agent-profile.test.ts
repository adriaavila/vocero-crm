import { describe, expect, it } from "vitest";
import {
  DEFAULT_AGENT_PROFILE,
  DEFAULT_AGENT_TEMPLATE_VERSION,
  defaultAgentProfile,
} from "@/server/agent/default-profile";

describe("plantilla SaaS del agente", () => {
  it("nace en pausa en cualquier marca: el dueño lo enciende en «Activar»", () => {
    expect(DEFAULT_AGENT_PROFILE.enabled).toBe(false);
    expect(defaultAgentProfile("allok").enabled).toBe(false);
    expect(defaultAgentProfile("rei").enabled).toBe(false);
  });

  it("allok lo llama Asistente y el saludo no repite el nombre", () => {
    const profile = defaultAgentProfile("allok");
    expect(DEFAULT_AGENT_TEMPLATE_VERSION).toBe("saas-v1");
    expect(profile).toMatchObject({
      name: "Asistente",
      allowlistEnabled: false,
      activationEnabled: false,
      aiProvider: "openrouter",
    });
    expect(profile.instructions).toContain("Nunca inventes");
    expect(profile.greeting).not.toMatch(/Rei|Soy Asistente/);
  });

  it("Rei conserva su nombre y su saludo", () => {
    const profile = defaultAgentProfile("rei");
    expect(profile.name).toBe("Rei");
    expect(profile.greeting).toContain("Rei");
  });

  it("sin marca explícita usa la del despliegue (allok por defecto)", () => {
    expect(defaultAgentProfile().name).toBe("Asistente");
  });

  it("la regla de escalado que ve el dueño no habla de «knowledge base»", () => {
    expect(defaultAgentProfile("allok").escalationRules).not.toMatch(/knowledge base/i);
  });

  it("devuelve objetos independientes para cada alta", () => {
    const first = defaultAgentProfile();
    const second = defaultAgentProfile();
    expect(first).not.toBe(second);
    expect(first.activationMessages).not.toBe(second.activationMessages);
    expect(first.allowedWaIds).not.toBe(second.allowedWaIds);
  });
});

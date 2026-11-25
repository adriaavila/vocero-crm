import { describe, expect, it } from "vitest";
import { isSuggestedHandoff, SUGGESTED_HANDOFF } from "@/lib/negocio";
import {
  DEFAULT_AGENT_PROFILE,
  DEFAULT_AGENT_TEMPLATE_VERSION,
  defaultAgentProfile,
  defaultResponseSchedule,
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

  it("la regla de escalado que ve el dueño está en su voz y es la sugerida", () => {
    const rules = defaultAgentProfile("allok").escalationRules;
    expect(rules).toBe(SUGGESTED_HANDOFF);
    expect(rules).not.toMatch(/knowledge base|^Pasa /i);
    expect(isSuggestedHandoff(rules)).toBe(true);
  });

  it("devuelve objetos independientes para cada alta", () => {
    const first = defaultAgentProfile();
    const second = defaultAgentProfile();
    expect(first).not.toBe(second);
    expect(first.activationMessages).not.toBe(second.activationMessages);
    expect(first.allowedWaIds).not.toBe(second.allowedWaIds);
  });
});

describe("horario con el que nace un negocio SaaS", () => {
  it("por defecto contesta cuando el equipo no atiende (lunes a sábado, 9 a 18)", () => {
    const schedule = defaultResponseSchedule("America/Caracas");
    expect(schedule.responseMode).toBe("outside_hours");
    expect(schedule.businessTimezone).toBe("America/Caracas");
    expect(Object.keys(schedule.businessHours)).toEqual(["mon", "tue", "wed", "thu", "fri", "sat"]);
  });

  it("la prueba de autoservicio (Completo) nace en «todo el día» y guarda la semana igual", () => {
    const schedule = defaultResponseSchedule(null, { allDay: true });
    expect(schedule.responseMode).toBe("all_day");
    // Para cuando elija «cuando no atiendes tú» o pague Esencial.
    expect(schedule.businessHours.mon).toEqual([{ start: "09:00", end: "18:00" }]);
    expect(schedule).not.toHaveProperty("businessTimezone");
  });
});

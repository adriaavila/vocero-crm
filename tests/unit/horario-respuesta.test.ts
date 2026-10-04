import { describe, expect, it } from "vitest";
import { hoursSignature, hoursSummary, type HoursSettings } from "@/components/agencia/horario-respuesta";

const open = (start = "09:00", end = "18:00") => [{ start, end }];
const monSat: HoursSettings = {
  weeklyHours: { mon: open(), tue: open(), wed: open(), thu: open(), fri: open(), sat: open() },
  timezone: "America/Caracas",
  responseMode: "outside_hours",
  handoffResumeHours: null,
};

describe("hoursSummary: la frase que queda al plegar el horario", () => {
  it("dice quién atiende y en qué hora", () => {
    expect(hoursSummary(monSat)).toBe("Atiendes tú lunes a sábado, de 09:00 a 18:00 · Hora de Caracas");
  });

  it("todo el día", () => {
    expect(hoursSummary({ ...monSat, responseMode: "all_day" })).toBe("Tu agente responde todo el día · Hora de Caracas");
  });

  it("sin días con horas", () => {
    expect(hoursSummary({ ...monSat, weeklyHours: {} })).toBe("Todavía sin horario");
  });
});

describe("hoursSignature: detecta cambios reales, no de orden", () => {
  it("el mismo horario con las claves en otro orden da la misma firma", () => {
    const shuffled: HoursSettings = {
      responseMode: "outside_hours",
      timezone: "America/Caracas",
      handoffResumeHours: null,
      weeklyHours: { sat: open(), fri: open(), thu: open(), wed: open(), tue: open(), mon: open() },
    };
    expect(hoursSignature(shuffled)).toBe(hoursSignature(monSat));
  });

  it("cambiar una hora, la zona o el modo cambia la firma", () => {
    const base = hoursSignature(monSat);
    expect(hoursSignature({ ...monSat, weeklyHours: { ...monSat.weeklyHours, sun: open() } })).not.toBe(base);
    expect(hoursSignature({ ...monSat, weeklyHours: { ...monSat.weeklyHours, mon: open("10:00", "18:00") } })).not.toBe(base);
    expect(hoursSignature({ ...monSat, timezone: "America/Bogota" })).not.toBe(base);
    expect(hoursSignature({ ...monSat, responseMode: "all_day" })).not.toBe(base);
  });
});

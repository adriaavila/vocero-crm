import { describe, expect, it } from "vitest";
import {
  describeAgentSchedule,
  describeTeamHours,
  nextAgentStart,
  timezoneLabel,
} from "@/server/agencia/horario-texto";
import type { BusinessHoursSettings } from "@/server/business-hours";

const open = (start = "09:00", end = "18:00") => [{ start, end }];
const monSat: BusinessHoursSettings = {
  weeklyHours: { mon: open(), tue: open(), wed: open(), thu: open(), fri: open(), sat: open() },
  timezone: "America/Caracas",
  responseMode: "outside_hours",
};

// 2026-08-10 es lunes. Caracas es UTC-4 todo el año.
const mondayNoon = new Date("2026-08-10T16:00:00Z"); // 12:00 en Caracas: el equipo atiende
const mondayNight = new Date("2026-08-11T00:00:00Z"); // lunes 20:00: responde el agente
const sundayNoon = new Date("2026-08-16T16:00:00Z"); // domingo 12:00: sin horario, responde el agente

describe("describeTeamHours", () => {
  it("junta los días seguidos con las mismas horas", () => {
    expect(describeTeamHours(monSat)).toBe("lunes a sábado, de 09:00 a 18:00");
  });

  it("separa los grupos con horas distintas", () => {
    expect(
      describeTeamHours({ ...monSat, weeklyHours: { mon: open(), tue: open(), wed: open("10:00", "14:00"), fri: open() } }),
    ).toBe("lunes y martes, de 09:00 a 18:00; miércoles, de 10:00 a 14:00; viernes, de 09:00 a 18:00");
  });

  it("un día de 24 horas se dice «todo el día»; sin días devuelve null", () => {
    expect(describeTeamHours({ ...monSat, weeklyHours: { sat: [{ start: "00:00", end: "00:00" }] } })).toBe("sábado, todo el día");
    expect(describeTeamHours({ ...monSat, weeklyHours: {} })).toBeNull();
  });
});

describe("describeAgentSchedule", () => {
  it("sin horario configurado no hay nada que decir", () => {
    expect(describeAgentSchedule({ ...monSat, weeklyHours: {} }, mondayNoon)).toBeNull();
  });

  it("mientras atiende el equipo dice cuándo empieza el agente", () => {
    const result = describeAgentSchedule(monSat, mondayNoon)!;
    expect(result.rule).toBe("Atiendes tú lunes a sábado, de 09:00 a 18:00. Tu agente responde el resto del tiempo.");
    expect(result.now).toBe("Ahora atiendes tú. Tu agente empieza a responder hoy a las 18:00.");
    expect(result.timezone).toBe("Hora de Caracas");
  });

  it("fuera del horario del equipo, responde el agente", () => {
    expect(describeAgentSchedule(monSat, mondayNight)!.now).toBe("Ahora mismo responde tu agente.");
    expect(describeAgentSchedule(monSat, sundayNoon)!.now).toBe("Ahora mismo responde tu agente.");
  });

  it("todo el día", () => {
    const result = describeAgentSchedule({ ...monSat, responseMode: "all_day" }, mondayNoon)!;
    expect(result.rule).toBe("Tu agente responde todos los días, a toda hora.");
    expect(result.now).toBe("Ahora mismo responde tu agente.");
  });
});

describe("nextAgentStart", () => {
  it("de lunes a sábado a las 17:59, el agente empieza a las 18:00 en punto", () => {
    const start = nextAgentStart(monSat, new Date("2026-08-10T21:59:00Z"))!; // 17:59 en Caracas
    expect(start.toISOString()).toBe("2026-08-10T22:00:00.000Z");
  });

  it("un tramo que cruza la medianoche termina al día siguiente", () => {
    const night: BusinessHoursSettings = {
      ...monSat,
      weeklyHours: { mon: open("22:00", "06:00") },
    };
    // Lunes 23:00 Caracas: atiende el equipo; el agente vuelve el martes a las 06:00.
    const start = nextAgentStart(night, new Date("2026-08-11T03:00:00Z"))!;
    expect(start.toISOString()).toBe("2026-08-11T10:00:00.000Z");
  });

  it("si ya responde el agente, es ahora", () => {
    expect(nextAgentStart(monSat, mondayNight)?.getTime()).toBe(mondayNight.getTime());
  });
});

describe("timezoneLabel", () => {
  it("deja solo la ciudad", () => {
    expect(timezoneLabel("America/Argentina/Buenos_Aires")).toBe("Buenos Aires");
    expect(timezoneLabel("America/Caracas")).toBe("Caracas");
  });
});

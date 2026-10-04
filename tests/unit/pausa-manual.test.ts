import { describe, expect, it } from "vitest";
import {
  DEFAULT_HANDOFF_RESUME_HOURS,
  manualPauseExpired,
  manualPauseResume,
  manualPauseResumeAt,
  pausaInfo,
  resumeHours,
} from "@/server/agencia/pausa-manual";
import { DEFAULT_BUSINESS_HOURS, type BusinessHoursSettings } from "@/server/business-hours";

/**
 * Fork — la pausa por respuesta manual vence (server/agencia/pausa-manual).
 * Reglas puras; lo que toca la base vive en pausa-manual-realdb.test.ts.
 */

// Lunes 2026-09-07, 15:00 en México (UTC-6) = 21:00Z.
const base: BusinessHoursSettings = { ...DEFAULT_BUSINESS_HOURS, timezone: "America/Mexico_City" };
const pausedAt = (iso: string) => ({ handoffAt: iso, handoffReason: "manual_reply" as const });
const at = (iso: string) => new Date(iso);

describe("resumeHours", () => {
  it("null = 12 h; 0 y otros valores se respetan", () => {
    expect(resumeHours({ handoffResumeHours: null })).toBe(DEFAULT_HANDOFF_RESUME_HOURS);
    expect(resumeHours({ handoffResumeHours: 0 })).toBe(0);
    expect(resumeHours({ handoffResumeHours: 3 })).toBe(3);
  });
});

describe("manualPauseResumeAt", () => {
  it("solo una pausa manual tiene vencimiento", () => {
    expect(manualPauseResumeAt({ handoffAt: "2026-09-07T21:00:00Z", handoffReason: "cliente" }, base)).toBeNull();
    expect(manualPauseResumeAt({ handoffAt: null, handoffReason: "manual_reply" }, base)).toBeNull();
    expect(manualPauseResumeAt(pausedAt("2026-09-07T21:00:00Z"), base)?.toISOString()).toBe("2026-09-08T09:00:00.000Z");
  });

  it("con 0 horas nunca vence", () => {
    expect(manualPauseResumeAt(pausedAt("2026-09-07T21:00:00Z"), { ...base, handoffResumeHours: 0 })).toBeNull();
  });
});

describe("manualPauseExpired: por horas", () => {
  const paused = pausedAt("2026-09-07T21:00:00Z");

  it("antes de las horas no, a partir de las horas sí", () => {
    expect(manualPauseExpired(paused, base, at("2026-09-08T08:59:00Z"))).toBe(false);
    expect(manualPauseExpired(paused, base, at("2026-09-08T09:00:00Z"))).toBe(true);
  });

  it("respeta las horas del negocio y «nunca»", () => {
    expect(manualPauseExpired(paused, { ...base, handoffResumeHours: 2 }, at("2026-09-07T23:00:00Z"))).toBe(true);
    expect(manualPauseExpired(paused, { ...base, handoffResumeHours: 0 }, at("2026-09-30T00:00:00Z"))).toBe(false);
  });

  it("los traspasos del agente jamás vencen", () => {
    for (const reason of ["cliente", "modelo", "error", "ventana", "hostilidad"]) {
      expect(manualPauseExpired({ handoffAt: "2026-09-01T00:00:00Z", handoffReason: reason }, base, at("2026-09-30T00:00:00Z"))).toBe(false);
    }
  });
});

describe("manualPauseExpired: turno del agente (fuera de horario)", () => {
  const turno: BusinessHoursSettings = {
    ...base,
    responseMode: "outside_hours",
    weeklyHours: { mon: [{ start: "09:00", end: "18:00" }], tue: [{ start: "09:00", end: "18:00" }] },
  };
  // Pausa a las 15:00 locales del lunes (dentro del horario).
  const deDia = pausedAt("2026-09-07T21:00:00Z");

  it("una pausa de media tarde vence al terminar el horario, antes de las 12 h", () => {
    expect(manualPauseExpired(deDia, turno, at("2026-09-07T23:30:00Z"))).toBe(false); // 17:30, aún abierto
    expect(manualPauseExpired(deDia, turno, at("2026-09-08T00:05:00Z"))).toBe(true); // 18:05, empezó el turno
  });

  it("el turno no arranca encima de una respuesta recién escrita (una hora de gracia)", () => {
    const alCierre = pausedAt("2026-09-07T23:59:00Z"); // 17:59 locales
    expect(manualPauseExpired(alCierre, turno, at("2026-09-08T00:05:00Z"))).toBe(false); // 18:05
    expect(manualPauseExpired(alCierre, turno, at("2026-09-08T01:00:00Z"))).toBe(true); // 19:00
  });

  it("una pausa nacida de noche (el dueño atendiendo a mano) solo vence por horas", () => {
    const deNoche = pausedAt("2026-09-08T03:00:00Z"); // 21:00 locales del lunes
    expect(manualPauseExpired(deNoche, turno, at("2026-09-08T05:00:00Z"))).toBe(false); // 23:00, 2 h
    expect(manualPauseExpired(deNoche, turno, at("2026-09-08T15:00:00Z"))).toBe(true); // 12 h
  });

  it("sin horario configurado, o todo el día, no hay turno que la venza", () => {
    expect(manualPauseResume(deDia, { ...turno, weeklyHours: {} })).toEqual({ at: at("2026-09-08T09:00:00Z"), by: "hours" });
    expect(manualPauseResume(deDia, { ...turno, responseMode: "all_day" })).toEqual({ at: at("2026-09-08T09:00:00Z"), by: "hours" });
    expect(manualPauseResume(deDia, { ...turno, handoffResumeHours: 0 })).toBeNull();
    expect(manualPauseExpired(deDia, { ...turno, responseMode: "all_day" }, at("2026-09-08T00:05:00Z"))).toBe(false);
  });

  it("el instante del turno es fijo: vencida sigue vencida aunque el horario vuelva a abrir", () => {
    // Pausa a las 15:00 del lunes; cierre 18:00; el martes a las 10:00 (abierto otra vez) sigue vencida.
    expect(manualPauseResume(deDia, { ...turno, handoffResumeHours: 48 })).toEqual({ at: at("2026-09-08T00:00:00Z"), by: "shift" });
    expect(manualPauseExpired(deDia, { ...turno, handoffResumeHours: 48 }, at("2026-09-08T16:00:00Z"))).toBe(true);
  });
});

describe("pausaInfo (lo que ve la bandeja)", () => {
  it("dice cuándo vuelve la IA y por qué: el cierre del horario gana a las horas si llega antes", () => {
    const turno: BusinessHoursSettings = { ...base, weeklyHours: { mon: [{ start: "09:00", end: "18:00" }] } };
    // Lunes 15:00 locales: cierra a las 18:00 (00:00Z), antes de las 12 h.
    expect(pausaInfo(pausedAt("2026-09-07T21:00:00Z"), turno)).toEqual({
      aiResumeAt: "2026-09-08T00:00:00.000Z",
      aiResumeBy: "shift",
    });
    // Pausa nacida fuera del horario (domingo): solo vence por horas, y la
    // bandeja no promete un cierre que ya pasó.
    expect(pausaInfo(pausedAt("2026-09-06T21:00:00Z"), turno)).toEqual({
      aiResumeAt: "2026-09-07T09:00:00.000Z",
      aiResumeBy: "hours",
    });
    // Con 2 horas, las horas llegan antes que el cierre.
    expect(pausaInfo(pausedAt("2026-09-07T21:00:00Z"), { ...turno, handoffResumeHours: 2 })).toEqual({
      aiResumeAt: "2026-09-07T23:00:00.000Z",
      aiResumeBy: "hours",
    });
    expect(pausaInfo(pausedAt("2026-09-07T21:00:00Z"), { ...turno, handoffResumeHours: 0 })).toEqual({
      aiResumeAt: null,
      aiResumeBy: null,
    });
    expect(pausaInfo({ handoffAt: "2026-09-07T21:00:00Z", handoffReason: "cliente" }, turno)).toEqual({
      aiResumeAt: null,
      aiResumeBy: null,
    });
  });
});

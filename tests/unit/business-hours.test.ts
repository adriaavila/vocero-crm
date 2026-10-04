import { describe, expect, it } from "vitest";
import {
  businessHoursCloseAfter,
  businessHoursFromProfile,
  DEFAULT_BUSINESS_HOURS,
  isBusinessHoursOpen,
  isOutsideBusinessHours,
  normalizeHandoffResumeHours,
  type BusinessHoursSettings,
} from "@/server/business-hours";

const base: BusinessHoursSettings = {
  ...DEFAULT_BUSINESS_HOURS,
  timezone: "America/Mexico_City",
};

describe("business hours for agent responses", () => {
  it("closed schedule never allows an automatic reply", () => {
    expect(isBusinessHoursOpen(base, new Date("2026-09-07T16:00:00Z"))).toBe(false);
  });

  it("uses the business timezone and excludes the closing minute", () => {
    const settings = {
      ...base,
      weeklyHours: { mon: [{ start: "09:00", end: "18:00" }] },
    };
    expect(isBusinessHoursOpen(settings, new Date("2026-09-07T15:00:00Z"))).toBe(true);
    expect(isBusinessHoursOpen(settings, new Date("2026-09-08T00:00:00Z"))).toBe(false);
  });

  it("identifies the outside-hours window as the complement of business hours", () => {
    const settings = {
      ...base,
      weeklyHours: { mon: [{ start: "09:00", end: "18:00" }] },
    };
    expect(isOutsideBusinessHours(settings, new Date("2026-09-07T15:00:00Z"))).toBe(false);
    expect(isOutsideBusinessHours(settings, new Date("2026-09-08T05:00:00Z"))).toBe(true);
  });

  it("keeps an overnight interval open after midnight", () => {
    const settings = {
      ...base,
      weeklyHours: { mon: [{ start: "22:00", end: "02:00" }] },
    };
    expect(isBusinessHoursOpen(settings, new Date("2026-09-08T06:00:00Z"))).toBe(true);
    expect(isBusinessHoursOpen(settings, new Date("2026-09-08T09:00:00Z"))).toBe(false);
  });

  it("supports a full-day interval and the Pro all-day mode", () => {
    expect(isBusinessHoursOpen({ ...base, weeklyHours: { sun: [{ start: "00:00", end: "00:00" }] } }, new Date("2026-09-13T18:00:00Z"))).toBe(true);
    expect(isBusinessHoursOpen({ ...base, responseMode: "all_day" }, new Date("2026-09-13T03:00:00Z"))).toBe(true);
  });
});

describe("fork — horas hasta que la IA retoma (pausa que vence)", () => {
  it("null = default; 0 = nunca; fuera de rango o no entero → null", () => {
    expect(normalizeHandoffResumeHours(null)).toBeNull();
    expect(normalizeHandoffResumeHours(undefined)).toBeNull();
    expect(normalizeHandoffResumeHours(0)).toBe(0);
    expect(normalizeHandoffResumeHours(12)).toBe(12);
    expect(normalizeHandoffResumeHours(168)).toBe(168);
    expect(normalizeHandoffResumeHours(169)).toBeNull();
    expect(normalizeHandoffResumeHours(-1)).toBeNull();
    expect(normalizeHandoffResumeHours(1.5)).toBeNull();
  });

  it("viaja con el horario del perfil", () => {
    expect(businessHoursFromProfile({ responseMode: "all_day", handoffResumeHours: 6 }).handoffResumeHours).toBe(6);
    expect(businessHoursFromProfile({ responseMode: "all_day" }).handoffResumeHours).toBeNull();
  });
});

describe("fork — cuándo cierra el horario abierto (el turno del agente)", () => {
  const mon = { ...base, weeklyHours: { mon: [{ start: "09:00", end: "18:00" }] } };

  it("dentro del tramo devuelve su cierre; fuera, nunca o todo el día, null", () => {
    expect(businessHoursCloseAfter(mon, new Date("2026-09-07T21:00:00Z"))?.toISOString()).toBe("2026-09-08T00:00:00.000Z");
    expect(businessHoursCloseAfter(mon, new Date("2026-09-08T03:00:00Z"))).toBeNull(); // 21:00, cerrado
    expect(businessHoursCloseAfter({ ...mon, responseMode: "all_day" }, new Date("2026-09-07T21:00:00Z"))).toBeNull();
    expect(businessHoursCloseAfter({ ...base, weeklyHours: {} }, new Date("2026-09-07T21:00:00Z"))).toBeNull();
  });

  it("tramos contiguos cierran juntos; uno que cruza la medianoche cierra al día siguiente", () => {
    const partido = { ...base, weeklyHours: { mon: [{ start: "09:00", end: "13:00" }, { start: "13:00", end: "18:00" }] } };
    expect(businessHoursCloseAfter(partido, new Date("2026-09-07T16:00:00Z"))?.toISOString()).toBe("2026-09-08T00:00:00.000Z");
    const noche = { ...base, weeklyHours: { mon: [{ start: "22:00", end: "02:00" }] } };
    expect(businessHoursCloseAfter(noche, new Date("2026-09-08T05:00:00Z"))?.toISOString()).toBe("2026-09-08T08:00:00.000Z"); // lunes 23:00 → martes 02:00
    expect(businessHoursCloseAfter(noche, new Date("2026-09-08T07:00:00Z"))?.toISOString()).toBe("2026-09-08T08:00:00.000Z"); // martes 01:00, tramo de ayer
  });

  it("24 h todos los días nunca cierra", () => {
    const siempre = { ...base, weeklyHours: Object.fromEntries(["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => [d, [{ start: "00:00", end: "00:00" }]])) };
    expect(businessHoursCloseAfter(siempre as BusinessHoursSettings, new Date("2026-09-07T21:00:00Z"))).toBeNull();
  });
});

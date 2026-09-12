import { describe, expect, it } from "vitest";
import {
  DEFAULT_BUSINESS_HOURS,
  isBusinessHoursOpen,
  isOutsideBusinessHours,
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

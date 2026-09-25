import { describe, expect, it } from "vitest";
import { coverage, gaps, minuteInTz, teamSpans, weekdayInTz } from "@/lib/cobertura";
import { funnel } from "@/lib/embudo";

const open = { start: "09:00", end: "18:00" };

describe("cobertura", () => {
  it("in outside_hours the agent covers what the team leaves free", () => {
    expect(coverage({ tue: [open] }, "outside_hours", false, "tue")).toEqual({
      team: [[540, 1080]],
      agent: [[0, 540], [1080, 1440]],
    });
    // Un día cerrado, con horario en otros días: el agente lo cubre entero.
    expect(coverage({ tue: [open] }, "outside_hours", false, "sun").agent).toEqual([[0, 1440]]);
  });

  it("an interval past midnight keeps going the next day", () => {
    const week = { fri: [{ start: "20:00", end: "02:00" }] };
    expect(teamSpans(week, "fri")).toEqual([[1200, 1440]]);
    expect(teamSpans(week, "sat")).toEqual([[0, 120]]);
    expect(teamSpans({ mon: [{ start: "00:00", end: "00:00" }] }, "mon")).toEqual([[0, 1440]]);
    expect(gaps([[0, 1440]])).toEqual([]);
  });

  it("the agent stays silent without hours, and all_day needs Pro", () => {
    expect(coverage({}, "outside_hours", true, "mon").agent).toEqual([]);
    expect(coverage({ mon: [open] }, "all_day", false, "mon").agent).toEqual([]);
    expect(coverage({ mon: [open] }, "all_day", true, "mon").agent).toEqual([[0, 1440]]);
  });

  it("reads minute and weekday in the business time zone", () => {
    const at = new Date("2026-09-22T23:30:00Z"); // martes 19:30 en Caracas
    expect(minuteInTz(at, "America/Caracas")).toBe(19 * 60 + 30);
    expect(weekdayInTz(at, "America/Caracas")).toBe("tue");
    expect(weekdayInTz(at, "Asia/Tokyo")).toBe("wed");
  });
});

describe("embudo", () => {
  it("counts who reached at least each stage, with conversion and close", () => {
    const f = funnel([
      { id: "a", name: "Nuevo", kind: "open", count: 5 },
      { id: "b", name: "Conversando", kind: "open", count: 3 },
      { id: "c", name: "Interesado", kind: "open", count: 2 },
      { id: "d", name: "Cliente", kind: "won", count: 1 },
      { id: "e", name: "Perdido", kind: "lost", count: 4 },
    ]);
    expect(f.steps.map((s) => s.reached)).toEqual([15, 6, 3, 1]);
    expect(f.steps.map((s) => s.fromPrev)).toEqual([null, 40, 50, 33]);
    expect(f).toMatchObject({ total: 15, won: 1, lost: 4, close: 7 });
    expect(f.steps[3]?.won).toBe(true);
  });

  it("an empty board draws no numbers", () => {
    const f = funnel([{ id: "a", name: "Nuevo", kind: "open", count: 0 }]);
    expect(f).toMatchObject({ total: 0, close: null });
    expect(f.steps[0]).toMatchObject({ reached: 0, share: 0, fromPrev: null });
  });
});

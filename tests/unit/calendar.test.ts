import { describe, expect, it } from "vitest";
import { buildAvailability } from "@/server/calendar";

const CARACAS = { timeZone: "America/Caracas", utcOffsetMinutes: -240 };

describe("disponibilidad del agente", () => {
  it("genera citas de 30 minutos desde las 09:00 de Caracas", () => {
    const slots = buildAvailability(
      new Date("2026-08-10T12:00:00.000Z"),
      [],
      2,
      CARACAS
    );
    expect(slots.map((slot) => [slot.startUtc, slot.endUtc])).toEqual([
      ["2026-08-10T13:00:00.000Z", "2026-08-10T13:30:00.000Z"],
      ["2026-08-10T13:45:00.000Z", "2026-08-10T14:15:00.000Z"],
    ]);
  });

  it("respeta el margen de 15 minutos alrededor de eventos ocupados", () => {
    const slots = buildAvailability(
      new Date("2026-08-10T12:00:00.000Z"),
      [
        {
          start: new Date("2026-08-10T13:00:00.000Z"),
          end: new Date("2026-08-10T13:30:00.000Z"),
        },
      ],
      1,
      CARACAS
    );
    expect(slots[0]?.startUtc).toBe("2026-08-10T13:45:00.000Z");
  });

  it("salta el fin de semana", () => {
    const slots = buildAvailability(
      new Date("2026-08-14T22:00:00.000Z"),
      [],
      1,
      CARACAS
    );
    expect(slots[0]?.startUtc).toBe("2026-08-17T13:00:00.000Z");
  });

  it("usa UTC como configuración neutral por defecto", () => {
    const slots = buildAvailability(
      new Date("2026-08-10T08:00:00.000Z"),
      [],
      1
    );
    expect(slots[0]?.startUtc).toBe("2026-08-10T09:00:00.000Z");
  });
});

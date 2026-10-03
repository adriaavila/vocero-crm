import { describe, expect, it } from "vitest";
import { haceTexto } from "@/lib/hace";

const now = new Date("2026-10-03T15:00:00Z");
const at = (iso: string) => haceTexto(iso, now, "UTC");

describe("haceTexto", () => {
  it("menos de un minuto", () => expect(at("2026-10-03T14:59:30Z")).toBe("hace un momento"));
  it("minutos", () => expect(at("2026-10-03T14:55:00Z")).toBe("hace 5 min"));
  it("hoy, con la hora", () => expect(at("2026-10-03T09:05:00Z")).toBe("hoy a las 09:05"));
  it("ayer", () => expect(at("2026-10-02T22:10:00Z")).toBe("ayer a las 22:10"));
  it("antes de ayer, con la fecha", () => expect(at("2026-09-28T08:00:00Z")).toMatch(/^el 28 sep\w* a las 08:00$/));
  it("una hora en el futuro por reloj desfasado no rompe", () => expect(at("2026-10-03T15:00:20Z")).toBe("hace un momento"));
});

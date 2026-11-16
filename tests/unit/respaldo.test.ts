import { describe, expect, it } from "vitest";
import { businessHoursFromProfile, CHARLA_DEL_AGENTE_MS, respaldoPermite } from "@/server/business-hours";

/**
 * Fork — respaldo: dentro del horario del equipo, el agente contesta a quien
 * lleva `backupMinutes` sin respuesta. Regla pura, sin BD ni reloj.
 */

const MIN = 60_000;
const MON_9_TO_18 = { mon: [{ start: "09:00", end: "18:00" }] };
const INSIDE = new Date("2026-09-07T15:00:00Z"); // lunes 09:00 en Ciudad de México
const OUTSIDE = new Date("2026-09-08T05:00:00Z"); // lunes 23:00

const settings = (over: { responseMode?: string; backupMinutes?: number | null } = {}) =>
  businessHoursFromProfile({
    businessHours: MON_9_TO_18,
    businessTimezone: "America/Mexico_City",
    responseMode: over.responseMode ?? "outside_hours",
    backupMinutes: over.backupMinutes === undefined ? 5 : over.backupMinutes,
  });

const espera = (minutosEsperando: number | null, minutosDesdeElAgente: number | null = null, now = INSIDE) => ({
  desde: minutosEsperando === null ? null : new Date(now.getTime() - minutosEsperando * MIN),
  ultimaDelAgente: minutosDesdeElAgente === null ? null : new Date(now.getTime() - minutosDesdeElAgente * MIN),
});

describe("respaldoPermite", () => {
  it("le da al equipo sus minutos: a los 4 calla, a los 5 contesta", () => {
    expect(respaldoPermite(settings(), true, espera(4), INSIDE)).toBe(false);
    expect(respaldoPermite(settings(), true, espera(5), INSIDE)).toBe(true);
    expect(respaldoPermite(settings(), true, espera(46), INSIDE)).toBe(true);
  });

  it("sin nada sin contestar no hay respaldo", () => {
    expect(respaldoPermite(settings(), true, espera(null), INSIDE)).toBe(false);
  });

  it("apagado (null o 0) es el «Cuando no atiendes tú» de siempre", () => {
    expect(respaldoPermite(settings({ backupMinutes: null }), true, espera(60), INSIDE)).toBe(false);
    expect(respaldoPermite(settings({ backupMinutes: 0 }), true, espera(60), INSIDE)).toBe(false);
  });

  it("es de Completo: sin ese plan no contesta en horario", () => {
    expect(respaldoPermite(settings(), false, espera(60), INSIDE)).toBe(false);
  });

  it("solo aplica dentro del horario (afuera ya contesta el turno normal)", () => {
    expect(respaldoPermite(settings(), true, espera(60, null, OUTSIDE), OUTSIDE)).toBe(false);
  });

  it("con «Todo el día» no aplica: ese modo ya contesta siempre", () => {
    expect(respaldoPermite(settings({ responseMode: "all_day" }), true, espera(60), INSIDE)).toBe(false);
  });

  it("una vez que el agente tomó el chat, sigue la charla sin volver a esperar", () => {
    expect(respaldoPermite(settings(), true, espera(0, 2), INSIDE)).toBe(true);
    expect(respaldoPermite(settings(), true, espera(1, CHARLA_DEL_AGENTE_MS / MIN), INSIDE)).toBe(true);
  });

  it("un chat que el agente dejó hace rato vuelve a esperar al equipo", () => {
    expect(respaldoPermite(settings(), true, espera(1, 300), INSIDE)).toBe(false);
    expect(respaldoPermite(settings(), true, espera(6, 300), INSIDE)).toBe(true);
  });

  it("un valor raro guardado en la base se lee como apagado", () => {
    expect(settings({ backupMinutes: 999 }).backupMinutes).toBeNull();
    expect(settings({ backupMinutes: -3 }).backupMinutes).toBeNull();
  });
});

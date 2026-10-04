import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import {
  addDaysISO,
  dayIsoInTz,
  isValidTimeZone,
  weekdayKeyOf,
  WEEKDAYS,
  type WeekdayKey,
} from "@/lib/time/slots";
import { hasSaaSPlan } from "@/server/agencia/entitlements";
import { isAllokSaaSMode } from "@/lib/tenant-host";

export type BusinessResponseMode = "outside_hours" | "all_day";
export type BusinessInterval = { start: string; end: string };
export type WeeklyBusinessHours = Partial<Record<WeekdayKey, BusinessInterval[]>>;

export type BusinessHoursSettings = {
  weeklyHours: WeeklyBusinessHours;
  timezone: string;
  responseMode: BusinessResponseMode;
  /**
   * Fork — pausa que vence: horas sin que el dueño escriba desde el teléfono
   * antes de que la IA retome el chat. null = default (12), 0 = nunca.
   * Ver `server/agencia/pausa-manual.ts`.
   */
  handoffResumeHours: number | null;
};

export const DEFAULT_BUSINESS_HOURS: BusinessHoursSettings = {
  weeklyHours: {},
  timezone: "America/Mexico_City",
  responseMode: "outside_hours",
  handoffResumeHours: null,
};

/** Tope del selector: una semana. Más que eso es "nunca", y para eso está el 0. */
export const MAX_HANDOFF_RESUME_HOURS = 168;

export function normalizeHandoffResumeHours(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(n) || n < 0 || n > MAX_HANDOFF_RESUME_HOURS) return null;
  return n;
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export function normalizeBusinessHours(input: unknown): WeeklyBusinessHours {
  const out: WeeklyBusinessHours = {};
  if (!input || typeof input !== "object" || Array.isArray(input)) return out;
  const source = input as Record<string, unknown>;

  for (const day of WEEKDAYS) {
    const rawIntervals = source[day];
    if (!Array.isArray(rawIntervals)) continue;
    const intervals = rawIntervals
      .filter(isBusinessInterval)
      .slice(0, 4)
      .sort((a, b) => a.start.localeCompare(b.start));
    if (intervals.some(isAllDayInterval)) {
      out[day] = [{ start: "00:00", end: "00:00" }];
    } else if (intervals.length > 0) {
      out[day] = intervals;
    }
  }
  return out;
}

export function businessHoursFromProfile(profile: {
  businessHours?: unknown;
  businessTimezone?: string;
  responseMode?: string;
  handoffResumeHours?: number | null;
}): BusinessHoursSettings {
  const timezone = profile.businessTimezone ?? "";
  return {
    weeklyHours: normalizeBusinessHours(profile.businessHours ?? {}),
    timezone: isValidTimeZone(timezone)
      ? timezone
      : DEFAULT_BUSINESS_HOURS.timezone,
    responseMode: profile.responseMode === "all_day" ? "all_day" : "outside_hours",
    handoffResumeHours: normalizeHandoffResumeHours(profile.handoffResumeHours),
  };
}

export function hasConfiguredBusinessHours(settings: BusinessHoursSettings): boolean {
  return settings.responseMode === "all_day" || Object.keys(settings.weeklyHours).length > 0;
}

/** True when the agent is allowed to answer at this instant. */
export function isBusinessHoursOpen(
  settings: BusinessHoursSettings,
  now = new Date(),
): boolean {
  if (settings.responseMode === "all_day") return true;
  if (!hasConfiguredBusinessHours(settings)) return false;

  const day = dayIsoInTz(now, settings.timezone);
  const weekday = weekdayKeyOf(day, settings.timezone);
  const previousDay = weekdayKeyOf(addDaysISO(day, -1), settings.timezone);
  if (!weekday || !previousDay) return false;

  const minute = localMinute(now, settings.timezone);
  const today = settings.weeklyHours[weekday] ?? [];
  const yesterday = settings.weeklyHours[previousDay] ?? [];

  return today.some((interval) => intervalIsOpenNow(interval, minute)) ||
    yesterday.some((interval) => intervalRunsPastMidnight(interval) && minute < toMinutes(interval.end));
}

export function isOutsideBusinessHours(
  settings: BusinessHoursSettings,
  now = new Date(),
): boolean {
  return hasConfiguredBusinessHours(settings) && !isBusinessHoursOpen(settings, now);
}

export async function getBusinessHours(organizationId: string): Promise<BusinessHoursSettings> {
  const profileFields = {
    businessHours: schema.agentProfile.businessHours,
    businessTimezone: schema.agentProfile.businessTimezone,
    responseMode: schema.agentProfile.responseMode,
    handoffResumeHours: schema.agentProfile.handoffResumeHours,
  };
  const rows = await getDb()
    .select(profileFields)
    .from(schema.agentProfile)
    .where(scoped(schema.agentProfile.organizationId, organizationId))
    .limit(1);
  const profile = rows[0];
  return profile ? businessHoursFromProfile(profile) : DEFAULT_BUSINESS_HOURS;
}

export class BusinessHoursError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BusinessHoursError";
  }
}

export async function saveBusinessHours(
  organizationId: string,
  input: Partial<BusinessHoursSettings> & { weeklyHours?: unknown },
): Promise<BusinessHoursSettings> {
  const current = await getBusinessHours(organizationId);
  const timezone = input.timezone ?? current.timezone;
  if (!isValidTimeZone(timezone)) {
    throw new BusinessHoursError(`Zona horaria desconocida: ${timezone}`);
  }
  const responseMode = input.responseMode ?? current.responseMode;
  if (responseMode !== "outside_hours" && responseMode !== "all_day") {
    throw new BusinessHoursError("Modo de respuesta desconocido");
  }

  // undefined = no lo mandaron (se conserva); null = "usa el default".
  const handoffResumeHours =
    input.handoffResumeHours === undefined
      ? current.handoffResumeHours
      : normalizeHandoffResumeHours(input.handoffResumeHours);
  if (input.handoffResumeHours != null && handoffResumeHours === null) {
    throw new BusinessHoursError(
      `Las horas hasta que la IA retoma van de 0 (nunca) a ${MAX_HANDOFF_RESUME_HOURS}`,
    );
  }

  const next: BusinessHoursSettings = {
    weeklyHours: normalizeBusinessHours(
      input.weeklyHours === undefined ? current.weeklyHours : input.weeklyHours,
    ),
    timezone,
    responseMode,
    handoffResumeHours,
  };
  const updated = await getDb()
    .update(schema.agentProfile)
    .set({
      businessHours: next.weeklyHours,
      businessTimezone: next.timezone,
      responseMode: next.responseMode,
      handoffResumeHours: next.handoffResumeHours,
      // Sin `updatedAt`: el horario no cambia lo que el agente dice, así que no
      // vuelve vieja la prueba (ver `server/agencia/contenido-perfil.ts`).
    })
    .where(scoped(schema.agentProfile.organizationId, organizationId))
    .returning({ id: schema.agentProfile.id });
  if (!updated[0]) throw new BusinessHoursError("Perfil del agente no encontrado");
  return next;
}

/** Final server-side schedule gate; legacy keeps its previous always-on behavior. */
export async function canAgentRespondNow(organizationId: string, now = new Date()): Promise<boolean> {
  if (!isAllokSaaSMode()) return true;
  const settings = await getBusinessHours(organizationId);
  if (!hasConfiguredBusinessHours(settings)) return false;
  // «Todo el día» es de Completo. Con Esencial (se bajó de plan, o lo eligió
  // durante la prueba) el agente contesta solo fuera del horario: el plan que
  // el dueño pagó, no un agente mudo (ver `coverage` en lib/cobertura).
  if (settings.responseMode === "all_day" && (await hasSaaSPlan(organizationId, "pro"))) return true;
  // `isOutsideBusinessHours` ve `all_day` como «siempre abierto» y devolvería
  // false: Esencial se evalúa como `outside_hours` con el mismo horario.
  return isOutsideBusinessHours({ ...settings, responseMode: "outside_hours" }, now);
}

function isBusinessInterval(value: unknown): value is BusinessInterval {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const { start, end } = value as { start?: unknown; end?: unknown };
  if (typeof start !== "string" || typeof end !== "string") return false;
  if (!HHMM.test(start) || !HHMM.test(end)) return false;
  return start !== end || (start === "00:00" && end === "00:00");
}

function isAllDayInterval(interval: BusinessInterval): boolean {
  return interval.start === "00:00" && interval.end === "00:00";
}

function intervalRunsPastMidnight(interval: BusinessInterval): boolean {
  return !isAllDayInterval(interval) && toMinutes(interval.start) > toMinutes(interval.end);
}

function intervalIsOpenNow(interval: BusinessInterval, minute: number): boolean {
  if (isAllDayInterval(interval)) return true;
  const start = toMinutes(interval.start);
  const end = toMinutes(interval.end);
  return start < end
    ? minute >= start && minute < end
    : minute >= start;
}

function toMinutes(value: string): number {
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
}

function localMinute(date: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0") % 24;
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "0");
  return hour * 60 + minute;
}

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
};

export const DEFAULT_BUSINESS_HOURS: BusinessHoursSettings = {
  weeklyHours: {},
  timezone: "America/Mexico_City",
  responseMode: "outside_hours",
};

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
}): BusinessHoursSettings {
  const timezone = profile.businessTimezone ?? "";
  return {
    weeklyHours: normalizeBusinessHours(profile.businessHours ?? {}),
    timezone: isValidTimeZone(timezone)
      ? timezone
      : DEFAULT_BUSINESS_HOURS.timezone,
    responseMode: profile.responseMode === "all_day" ? "all_day" : "outside_hours",
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

  const next: BusinessHoursSettings = {
    weeklyHours: normalizeBusinessHours(
      input.weeklyHours === undefined ? current.weeklyHours : input.weeklyHours,
    ),
    timezone,
    responseMode,
  };
  const updated = await getDb()
    .update(schema.agentProfile)
    .set({
      businessHours: next.weeklyHours,
      businessTimezone: next.timezone,
      responseMode: next.responseMode,
      updatedAt: new Date(),
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
  if (settings.responseMode === "all_day") {
    return hasSaaSPlan(organizationId, "pro");
  }
  return isOutsideBusinessHours(settings, now);
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

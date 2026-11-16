import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import {
  addDaysISO,
  dayIsoInTz,
  isValidTimeZone,
  weekdayKeyOf,
  WEEKDAYS,
  zonedWallClockToUtc,
  type WeekdayKey,
} from "@/lib/time/slots";
import { hasSaaSPlan } from "@/server/agencia/entitlements";
import { isAllokSaaSMode } from "@/lib/tenant-host";
import { sql } from "drizzle-orm";

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
  /**
   * Fork — respaldo: con «Cuando no atiendes tú», minutos que el agente le da
   * al equipo DENTRO del horario antes de contestar a un cliente que nadie
   * atendió. null = apagado. Ver `respaldoPermite`.
   */
  backupMinutes: number | null;
};

export const DEFAULT_BUSINESS_HOURS: BusinessHoursSettings = {
  weeklyHours: {},
  timezone: "America/Mexico_City",
  responseMode: "outside_hours",
  handoffResumeHours: null,
  backupMinutes: null,
};

/** Respaldo: de 1 a 60 minutos. Más que una hora ya no es respaldo, es otro turno. */
export const MAX_BACKUP_MINUTES = 60;

export function normalizeBackupMinutes(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(n) || n <= 0 || n > MAX_BACKUP_MINUTES) return null;
  return n;
}

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
  backupMinutes?: number | null;
}): BusinessHoursSettings {
  const timezone = profile.businessTimezone ?? "";
  return {
    weeklyHours: normalizeBusinessHours(profile.businessHours ?? {}),
    timezone: isValidTimeZone(timezone)
      ? timezone
      : DEFAULT_BUSINESS_HOURS.timezone,
    responseMode: profile.responseMode === "all_day" ? "all_day" : "outside_hours",
    handoffResumeHours: normalizeHandoffResumeHours(profile.handoffResumeHours),
    backupMinutes: normalizeBackupMinutes(profile.backupMinutes),
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

/**
 * Fork — pausa que vence: el instante en que CIERRA el tramo del horario del
 * equipo que está abierto en `from` (= cuando empieza el turno del agente en
 * modo fuera de horario). Camina los tramos contiguos (09–13 y 13–18 cierran
 * a las 18). null si en `from` el equipo no atiende, si el modo es todo el
 * día, o si el horario nunca cierra (24 h todos los días).
 */
export function businessHoursCloseAfter(
  settings: BusinessHoursSettings,
  from: Date,
): Date | null {
  if (settings.responseMode === "all_day" || !hasConfiguredBusinessHours(settings)) return null;
  if (!isBusinessHoursOpen(settings, from)) return null;
  const tz = settings.timezone;
  let cursor = from;
  for (let step = 0; step < 16; step++) {
    const day = dayIsoInTz(cursor, tz);
    const weekday = weekdayKeyOf(day, tz);
    const previousDay = weekdayKeyOf(addDaysISO(day, -1), tz);
    if (!weekday || !previousDay) return null;
    const minute = localMinute(cursor, tz);
    let close: Date | null = null;
    for (const interval of settings.weeklyHours[weekday] ?? []) {
      if (isAllDayInterval(interval)) {
        close = zonedWallClockToUtc(addDaysISO(day, 1), "00:00", tz);
        break;
      }
      if (intervalIsOpenNow(interval, minute)) {
        close = intervalRunsPastMidnight(interval)
          ? zonedWallClockToUtc(addDaysISO(day, 1), interval.end, tz)
          : zonedWallClockToUtc(day, interval.end, tz);
        break;
      }
    }
    if (!close) {
      for (const interval of settings.weeklyHours[previousDay] ?? []) {
        if (intervalRunsPastMidnight(interval) && minute < toMinutes(interval.end)) {
          close = zonedWallClockToUtc(day, interval.end, tz);
          break;
        }
      }
    }
    if (!close || close.getTime() <= cursor.getTime()) return null;
    if (!isBusinessHoursOpen(settings, close)) return close;
    cursor = close; // el siguiente tramo empieza justo al cerrar éste: seguir
  }
  return null;
}

export async function getBusinessHours(organizationId: string): Promise<BusinessHoursSettings> {
  const profileFields = {
    businessHours: schema.agentProfile.businessHours,
    businessTimezone: schema.agentProfile.businessTimezone,
    responseMode: schema.agentProfile.responseMode,
    handoffResumeHours: schema.agentProfile.handoffResumeHours,
    backupMinutes: schema.agentProfile.backupMinutes,
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

  // undefined = se conserva; null o 0 = apagado.
  const backupMinutes =
    input.backupMinutes === undefined
      ? current.backupMinutes
      : normalizeBackupMinutes(input.backupMinutes);
  if (input.backupMinutes != null && input.backupMinutes !== 0 && backupMinutes === null) {
    throw new BusinessHoursError(`El respaldo va de 1 a ${MAX_BACKUP_MINUTES} minutos`);
  }

  const next: BusinessHoursSettings = {
    weeklyHours: normalizeBusinessHours(
      input.weeklyHours === undefined ? current.weeklyHours : input.weeklyHours,
    ),
    timezone,
    responseMode,
    handoffResumeHours,
    backupMinutes,
  };
  const updated = await getDb()
    .update(schema.agentProfile)
    .set({
      businessHours: next.weeklyHours,
      businessTimezone: next.timezone,
      responseMode: next.responseMode,
      handoffResumeHours: next.handoffResumeHours,
      backupMinutes: next.backupMinutes,
      // Sin `updatedAt`: el horario no cambia lo que el agente dice, así que no
      // vuelve vieja la prueba (ver `server/agencia/contenido-perfil.ts`).
    })
    .where(scoped(schema.agentProfile.organizationId, organizationId))
    .returning({ id: schema.agentProfile.id });
  if (!updated[0]) throw new BusinessHoursError("Perfil del agente no encontrado");
  return next;
}

/**
 * La regla de `canAgentRespondNow`, pura: con el horario ya leído y si el plan
 * es Completo. Inicio la usa con lo que ya leyó para no preguntar dos veces.
 */
export function agentShiftOpen(settings: BusinessHoursSettings, pro: boolean, now = new Date()): boolean {
  if (!hasConfiguredBusinessHours(settings)) return false;
  // «Todo el día» es de Completo. Con Esencial (se bajó de plan, o lo eligió
  // durante la prueba) el agente contesta solo fuera del horario: el plan que
  // el dueño pagó, no un agente mudo (ver `coverage` en lib/cobertura).
  if (settings.responseMode === "all_day" && pro) return true;
  // `isOutsideBusinessHours` ve `all_day` como «siempre abierto» y devolvería
  // false: Esencial se evalúa como `outside_hours` con el mismo horario.
  return isOutsideBusinessHours({ ...settings, responseMode: "outside_hours" }, now);
}

/** Final server-side schedule gate; legacy keeps its previous always-on behavior. */
export async function canAgentRespondNow(organizationId: string, now = new Date()): Promise<boolean> {
  if (!isAllokSaaSMode()) return true;
  const settings = await getBusinessHours(organizationId);
  // El plan solo importa con «todo el día»: sin eso no se lee.
  const pro = settings.responseMode === "all_day" && (await hasSaaSPlan(organizationId, "pro"));
  return agentShiftOpen(settings, pro, now);
}

/**
 * Fork — respaldo, la regla pura. En «Cuando no atiendes tú» el agente calla
 * mientras el equipo atiende. Leído en Rei (SAMER, 21 al 28-10): 40 clientes
 * nuevos del anuncio, 39 contestados a mano, mediana 46 min y p90 de 7 h. El
 * equipo contesta, pero tarde, y en bienes raíces el que contesta primero se
 * lleva la visita. Con respaldo, dentro del horario el agente contesta a un
 * cliente que lleva `backupMinutes` esperando sin que nadie le conteste.
 *
 * Una vez que el agente tomó el chat, la charla sigue a su ritmo: si su
 * última respuesta es de hace menos de `CHARLA_DEL_AGENTE_MS`, contesta sin
 * volver a esperar (un cliente no puede esperar 5 min en cada mensaje). Un
 * chat de la noche que el cliente retoma a media mañana vuelve a esperar al
 * equipo.
 *
 * Lo que NO hace, a propósito:
 *  - meterse en un chat que el equipo ya lleva: una respuesta desde el
 *    teléfono pausa el chat (`pausa-manual.ts`) y el turno ni se pide;
 *  - adelantarse: cuenta desde el PRIMER mensaje sin contestar, así que un
 *    cliente que escribe en ráfagas no corre el reloj;
 *  - ser «Todo el día» gratis: contestar en horario es de Completo, igual que
 *    «Todo el día». Sin ese plan el respaldo no aplica.
 */
export const CHARLA_DEL_AGENTE_MS = 30 * 60_000;

export type EsperaDelCliente = {
  /** Primer mensaje del cliente después de la última respuesta; null = nada sin contestar. */
  desde: Date | null;
  /** La última respuesta, si fue del agente; null si fue de una persona o no hubo. */
  ultimaDelAgente: Date | null;
};

export function respaldoPermite(
  settings: BusinessHoursSettings,
  pro: boolean,
  espera: EsperaDelCliente,
  now = new Date(),
): boolean {
  if (settings.responseMode !== "outside_hours" || !pro) return false;
  const minutes = settings.backupMinutes;
  if (!minutes || !espera.desde) return false;
  if (!isBusinessHoursOpen(settings, now)) return false;
  if (espera.ultimaDelAgente && now.getTime() - espera.ultimaDelAgente.getTime() <= CHARLA_DEL_AGENTE_MS) {
    return true;
  }
  return now.getTime() - espera.desde.getTime() >= minutes * 60_000;
}

/** Lee la `EsperaDelCliente` de una conversación. */
export async function esperaDelCliente(
  organizationId: string,
  conversationId: string,
): Promise<EsperaDelCliente> {
  // El SQL crudo devuelve fechas como texto sin zona: se piden los instantes
  // en milisegundos (mismo cuidado que `clientes-esperando.ts`). Un saliente
  // que falló no cuenta como respuesta: el cliente sigue esperando.
  const rows = (await getDb().execute(sql`
    WITH ultima AS (
      SELECT o.created_at, o.origin FROM message o
      WHERE o.organization_id = ${organizationId}
        AND o.conversation_id = ${conversationId}
        AND o.direction = 'out'
        AND o.status <> 'failed'
      ORDER BY o.created_at DESC
      LIMIT 1
    )
    SELECT
      (SELECT (extract(epoch from min(m.created_at)) * 1000)::float8
         FROM message m
        WHERE m.organization_id = ${organizationId}
          AND m.conversation_id = ${conversationId}
          AND m.direction = 'in'
          AND m.created_at > COALESCE((SELECT created_at FROM ultima), '-infinity'::timestamp)
      ) AS desde_ms,
      (SELECT (extract(epoch from created_at) * 1000)::float8 FROM ultima WHERE origin = 'ai') AS ia_ms
  `)) as unknown as { desde_ms: number | null; ia_ms: number | null }[];
  const row = rows[0];
  const toDate = (ms: number | null | undefined) => (ms === null || ms === undefined ? null : new Date(Number(ms)));
  return { desde: toDate(row?.desde_ms), ultimaDelAgente: toDate(row?.ia_ms) };
}

/**
 * Lo que el respaldo necesita de un negocio, leído una vez (el barrido lo
 * cachea por negocio). null si ese negocio no tiene respaldo que aplicar.
 */
export async function respaldoDelNegocio(
  organizationId: string,
): Promise<{ settings: BusinessHoursSettings; pro: boolean } | null> {
  const settings = await getBusinessHours(organizationId);
  if (settings.responseMode !== "outside_hours" || !settings.backupMinutes) return null;
  const pro = await hasSaaSPlan(organizationId, "pro");
  return pro ? { settings, pro } : null;
}

export async function canAgentAnswerConversation(
  organizationId: string,
  conversationId: string,
  now = new Date(),
): Promise<boolean> {
  if (!isAllokSaaSMode()) return true;
  const settings = await getBusinessHours(organizationId);
  const needsPro = settings.responseMode === "all_day" || Boolean(settings.backupMinutes);
  const pro = needsPro && (await hasSaaSPlan(organizationId, "pro"));
  if (agentShiftOpen(settings, pro, now)) return true;
  if (!pro || !settings.backupMinutes || !isBusinessHoursOpen(settings, now)) return false;
  return respaldoPermite(settings, pro, await esperaDelCliente(organizationId, conversationId), now);
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

"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronRight, Clock3 } from "lucide-react";
import { AgentWeek } from "@/components/agencia/allok/agent-week";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { TimezoneSelect } from "@/components/ui/timezone-select";
import { describeTeamHours, timezoneLabel } from "@/lib/horario";
import type { SaveResult } from "@/lib/negocio";
import { WEEKDAYS, type WeekdayKey } from "@/lib/time/slots";

/**
 * Capa de agencia: el horario de respuesta como parte de «Tu negocio».
 *
 * Es el mismo editor de siempre (modo, la semana del agente, horas por día,
 * zona), pero ya no es una tarjeta con su propio botón: vive plegado dentro de
 * Tu negocio, con una frase que dice lo que hay puesto, y se guarda con el
 * ÚNICO botón «Guardar mi negocio». En el teléfono cada día es una línea con
 * el día y «24 h» arriba y las dos horas abajo; antes se partía en tres
 * renglones desiguales.
 */

type Interval = { start: string; end: string };
export type HoursSettings = {
  weeklyHours: Partial<Record<WeekdayKey, Interval[]>>;
  timezone: string;
  responseMode: "outside_hours" | "all_day";
};

const DAYS: { key: WeekdayKey; label: string; short: string }[] = [
  { key: "mon", label: "Lunes", short: "L" },
  { key: "tue", label: "Martes", short: "M" },
  { key: "wed", label: "Miércoles", short: "X" },
  { key: "thu", label: "Jueves", short: "J" },
  { key: "fri", label: "Viernes", short: "V" },
  { key: "sat", label: "Sábado", short: "S" },
  { key: "sun", label: "Domingo", short: "D" },
];

/** Una firma estable: dos horarios iguales dan la misma, sin importar el orden de las claves. */
export function hoursSignature(s: HoursSettings): string {
  return JSON.stringify([WEEKDAYS.map((day) => s.weeklyHours[day] ?? []), s.timezone, s.responseMode]);
}

/** «Atiendes tú lunes a sábado, de 09:00 a 18:00 · Hora de Caracas», o lo que corresponda. */
export function hoursSummary(s: HoursSettings): string {
  if (s.responseMode === "all_day") return `Tu agente responde todo el día · Hora de ${timezoneLabel(s.timezone)}`;
  const team = describeTeamHours(s);
  if (!team) return "Todavía sin horario";
  return `Atiendes tú ${team} · Hora de ${timezoneLabel(s.timezone)}`;
}

export function useBusinessHours(enabled: boolean) {
  const [settings, setSettings] = useState<HoursSettings | null>(null);
  const [saved, setSaved] = useState<HoursSettings | null>(null);
  const [canUseAllDay, setCanUseAllDay] = useState(false);
  const [loaded, setLoaded] = useState(!enabled);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    void fetch("/api/settings/business-hours")
      .then(async (response) => {
        const payload = (await response.json().catch(() => null)) as { settings?: HoursSettings; canUseAllDay?: boolean } | null;
        if (!response.ok || !payload?.settings) throw new Error("No se pudo cargar el horario.");
        setSettings(payload.settings);
        setSaved(payload.settings);
        setCanUseAllDay(payload.canUseAllDay === true);
      })
      .catch((reason) => setLoadError(reason instanceof Error ? reason.message : "No se pudo cargar el horario."))
      .finally(() => setLoaded(true));
  }, [enabled]);

  const dirty = Boolean(settings && saved && hoursSignature(settings) !== hoursSignature(saved));

  const save = useCallback(async (): Promise<SaveResult> => {
    if (!settings) return { ok: true };
    const response = await fetch("/api/settings/business-hours", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(settings),
    }).catch(() => null);
    const payload = (await response?.json().catch(() => null)) as { settings?: HoursSettings; error?: { message?: string } } | null;
    if (!response?.ok || !payload?.settings) {
      return { ok: false, message: payload?.error?.message ?? "No se pudo guardar el horario." };
    }
    setSettings(payload.settings);
    setSaved(payload.settings);
    return { ok: true };
  }, [settings]);

  return { enabled, settings, setSettings, canUseAllDay, loaded, loadError, dirty, save };
}

export type HoursController = ReturnType<typeof useBusinessHours>;

export function HorarioRespuesta({
  hours,
  brandName,
  open,
  onOpenChange,
  disabled = false,
}: {
  hours: HoursController;
  /** Marca en minúscula, para una oración. */
  brandName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  disabled?: boolean;
}) {
  const { settings, setSettings, canUseAllDay } = hours;

  if (!hours.loaded || (!settings && !hours.loadError)) {
    return <Skeleton className="h-16 w-full" aria-label="Cargando el horario" />;
  }
  if (!settings) {
    return (
      <p role="alert" className="rounded-md border border-danger-soft bg-danger-tint px-3 py-2 text-sm text-danger-text">
        {hours.loadError}
      </p>
    );
  }
  const current = settings;

  function toggleDay(day: WeekdayKey) {
    const next = { ...current.weeklyHours };
    if (next[day]?.length) delete next[day];
    else next[day] = [{ start: "09:00", end: "18:00" }];
    setSettings({ ...current, weeklyHours: next });
  }

  function setDayTime(day: WeekdayKey, field: keyof Interval, value: string) {
    setSettings({
      ...current,
      weeklyHours: {
        ...current.weeklyHours,
        [day]: [{ ...(current.weeklyHours[day]?.[0] ?? { start: "09:00", end: "18:00" }), [field]: value }],
      },
    });
  }

  function setDayAllDay(day: WeekdayKey, allDay: boolean) {
    setSettings({
      ...current,
      weeklyHours: {
        ...current.weeklyHours,
        [day]: [allDay ? { start: "00:00", end: "00:00" } : { start: "09:00", end: "18:00" }],
      },
    });
  }

  return (
    <details
      id="horario"
      open={open}
      onToggle={(event) => onOpenChange(event.currentTarget.open)}
      className="group scroll-mt-4 rounded-lg border border-border"
    >
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-3 px-3 py-2.5 [&::-webkit-details-marker]:hidden">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-tint text-brand-text">
          <Clock3 className="h-4 w-4" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">Horario de respuesta</span>
          <span className="block break-words text-xs leading-5 text-text-3">
            {hoursSummary(current)}
            {hours.dirty && <span className="font-medium text-warning-text"> · sin guardar</span>}
          </span>
        </span>
        <ChevronRight
          className="h-5 w-5 shrink-0 text-text-3 transition-transform group-open:rotate-90 motion-reduce:transition-none"
          aria-hidden="true"
        />
      </summary>

      <div className="space-y-4 border-t border-border p-3">
        <p className="text-sm text-text-2">
          {brandName} solo hablará por ti cuando esta regla lo permita. Es independiente del horario de citas.
        </p>

        <div className="grid gap-2 sm:grid-cols-2" role="group" aria-label="Modo de atención">
          <button
            type="button"
            disabled={disabled}
            onClick={() => setSettings({ ...current, responseMode: "outside_hours" })}
            className={`rounded-md border p-3 text-left transition-colors ${current.responseMode === "outside_hours" ? "border-brand bg-brand-tint" : "hover:bg-subtle"}`}
          >
            <span className="block text-sm font-semibold">Fuera de horario</span>
            <span className="mt-1 block text-xs leading-5 text-text-3">Ideal para Esencial: {brandName} cubre las horas en que tu equipo descansa.</span>
          </button>
          <button
            type="button"
            disabled={!canUseAllDay || disabled}
            onClick={() => setSettings({ ...current, responseMode: "all_day" })}
            className={`rounded-md border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-55 ${current.responseMode === "all_day" ? "border-brand bg-brand-tint" : "hover:bg-subtle"}`}
          >
            <span className="flex items-center gap-2 text-sm font-semibold">
              Todo el día <Badge variant="success">Completo</Badge>
            </span>
            <span className="mt-1 block text-xs leading-5 text-text-3">Responde durante toda la jornada, con supervisión humana siempre disponible.</span>
          </button>
        </div>

        <AgentWeek hours={current.weeklyHours} mode={current.responseMode} timezone={current.timezone} pro={canUseAllDay} />

        {current.responseMode === "outside_hours" && (
          <div className="rounded-md border p-3">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-text-3">Horario del negocio</p>
            <div className="mt-1 divide-y divide-border">
              {DAYS.map((day) => {
                const interval = current.weeklyHours[day.key]?.[0];
                const isOpen = Boolean(interval);
                const allDay = interval?.start === "00:00" && interval?.end === "00:00";
                return (
                  <div
                    key={day.key}
                    className="grid grid-cols-[1fr_auto_1fr] items-center gap-x-2 gap-y-1.5 py-2 sm:flex sm:flex-wrap sm:gap-2 sm:py-1"
                  >
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => toggleDay(day.key)}
                      aria-pressed={isOpen}
                      className={`col-span-2 flex h-11 items-center gap-2 rounded-md px-2 text-left text-sm font-medium sm:h-9 sm:w-24 ${isOpen ? "bg-brand-tint text-brand-text" : "text-text-3 hover:bg-subtle"}`}
                    >
                      <span className="grid h-5 w-5 place-items-center rounded-full border text-[10px]">{day.short}</span>
                      {day.label}
                    </button>
                    {!isOpen && <span className="justify-self-end text-sm text-text-3 sm:justify-self-auto">Cerrado</span>}
                    {isOpen && allDay && (
                      <div className="col-span-3 flex items-center gap-3 sm:contents">
                        <span className="rounded-md bg-brand-tint px-3 py-2 text-sm font-semibold text-brand-text">24 horas</span>
                        <button
                          type="button"
                          disabled={disabled}
                          onClick={() => setDayAllDay(day.key, false)}
                          className="inline-flex min-h-11 items-center text-xs font-semibold text-text-3 hover:text-foreground sm:min-h-9"
                        >
                          Definir horario
                        </button>
                      </div>
                    )}
                    {isOpen && !allDay && (
                      <>
                        <button
                          type="button"
                          disabled={disabled}
                          onClick={() => setDayAllDay(day.key, true)}
                          className="inline-flex min-h-11 items-center justify-self-end text-xs font-semibold text-brand-text hover:underline sm:order-last sm:min-h-9"
                        >
                          24 h
                        </button>
                        <Input
                          aria-label={`${day.label}: abre`}
                          type="time"
                          disabled={disabled}
                          value={interval?.start ?? "09:00"}
                          onChange={(event) => setDayTime(day.key, "start", event.target.value)}
                          className="h-11 min-w-0 px-2 sm:h-9 sm:w-28 sm:px-3"
                        />
                        <span className="text-center text-xs text-text-3">a</span>
                        <Input
                          aria-label={`${day.label}: cierra`}
                          type="time"
                          disabled={disabled}
                          value={interval?.end ?? "18:00"}
                          onChange={(event) => setDayTime(day.key, "end", event.target.value)}
                          className="h-11 min-w-0 px-2 sm:h-9 sm:w-28 sm:px-3"
                        />
                      </>
                    )}
                  </div>
                );
              })}
            </div>
            <p className="mt-2 text-xs leading-5 text-text-3">
              Un cierre a las 00:00 termina al comenzar el día siguiente. Usa <strong className="font-semibold text-text-2">24 h</strong> para mantener ese día siempre abierto.
            </p>
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="business-timezone">Zona horaria</Label>
          <TimezoneSelect
            id="business-timezone"
            value={current.timezone}
            onValueChange={(timezone) => setSettings({ ...current, timezone })}
            className="w-full"
          />
          <p className="text-xs text-text-3">Usa la zona del negocio, no la del servidor.</p>
        </div>
      </div>
    </details>
  );
}

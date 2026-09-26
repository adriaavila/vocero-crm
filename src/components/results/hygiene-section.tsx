"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCircle2, ChevronRight } from "lucide-react";
import type { HygieneBlockDto } from "@/lib/analytics";
import { formatMoneyCents } from "@/lib/money";
import { cn } from "@/lib/utils";
import { Section, Subhead } from "./section";

/** "2.9" horas dichas como se piensan: "2 h 54 min", no un decimal. */
function horasMinutos(horas: number): string {
  const totalMin = Math.max(0, Math.round(horas * 60));
  const h = Math.floor(totalMin / 60);
  const min = totalMin % 60;
  if (h <= 0) return `${min} min`;
  if (min === 0) return `${h} h`;
  return `${h} h ${min} min`;
}

/**
 * 019 — Lo que se está cayendo AHORA.
 *
 * Cada persona lleva a su conversación: una lista de problemas sin camino a
 * la acción es solo ansiedad. La Bandeja abre por contacto (`?contact=`).
 */
export function HygieneSection({
  data,
  loading,
  error,
  currency,
  onRetry,
}: {
  data: HygieneBlockDto | null;
  loading: boolean;
  error: string | null;
  currency: string;
  onRetry?: () => void;
}) {
  const money = (c: number) => formatMoneyCents(c, currency, undefined, { compact: true }) ?? "Sin datos";
  const enLista = data ? Math.min(data.silent.length, 8) : 0;
  // Motivos de Meta pueden ser largos ("Recipient phone number not in
  // allowed list…"); el título en hover no sirve en el teléfono, así que se
  // ve completo con un toque.
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set());
  const alternar = (clave: string) =>
    setExpandidos((prev) => {
      const next = new Set(prev);
      if (next.has(clave)) {
        next.delete(clave);
      } else {
        next.add(clave);
      }
      return next;
    });

  return (
    <Section
      id="higiene"
      title="Qué se está cayendo"
      hint="No depende del periodo: es lo que está pasando ahora mismo."
      loading={loading}
      error={error}
      onRetry={onRetry}
      hasData={!!data}
    >
      {data &&
        (data.clean ? (
          <p className="flex items-center justify-center gap-2 py-6 text-sm text-success-text">
            <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
            Nada pendiente: ni silencios, ni mensajes fallidos, ni ventanas por cerrarse.
          </p>
        ) : (
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="min-w-0">
              <Subhead>
                En silencio más de una semana
                {data.silentCount > 0 && (
                  <span className="ml-1.5 font-normal text-text-3">({data.silentCount})</span>
                )}
              </Subhead>
              {data.silentAmountCents > 0 && (
                <p className="-mt-1 mb-2 text-xs text-text-3">
                  {money(data.silentAmountCents)} en tratos que se enfrían
                </p>
              )}
              {data.silentCount === 0 ? (
                <p className="text-sm text-text-3">Nadie lleva más de una semana callado.</p>
              ) : (
                <>
                  <ul className="divide-y text-sm">
                    {data.silent.slice(0, enLista).map((l) => (
                      <li key={l.leadId}>
                        <Link
                          href={`/inbox?contact=${l.contactId}`}
                          className="-mx-1 flex min-h-11 items-center justify-between gap-2 rounded-sm px-1 hover:bg-accent hover:underline"
                        >
                          <span className="min-w-0 truncate text-brand-text">{l.name}</span>
                          <span className="flex shrink-0 items-center gap-1 text-xs text-text-3 tabular-nums">
                            {l.days} días
                            {l.amountCents ? ` · ${money(l.amountCents)}` : ""}
                            <ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden />
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                  {data.silentCount > enLista && (
                    <p className="mt-2 text-xs text-text-3">
                      y {data.silentCount - enLista} más.
                    </p>
                  )}
                </>
              )}
            </div>

            <div className="min-w-0">
              <Subhead>Mensajes que no llegaron (30 días)</Subhead>
              {data.failedMessages.length === 0 ? (
                <p className="text-sm text-text-3">Ningún envío fallido.</p>
              ) : (
                <ul className="space-y-1.5 text-sm">
                  {data.failedMessages.map((m) => {
                    const abierto = expandidos.has(m.error);
                    return (
                      <li key={m.error} className="flex items-start justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => alternar(m.error)}
                          aria-expanded={abierto}
                          className={cn(
                            "min-w-0 min-h-11 flex-1 py-1 text-left text-text-2 hover:underline sm:min-h-0",
                            !abierto && "line-clamp-2"
                          )}
                        >
                          {m.error}
                        </button>
                        <span className="shrink-0 pt-1 text-xs text-text-3 tabular-nums">
                          {m.count}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="min-w-0">
              <Subhead>Ventanas de 24 h por cerrarse</Subhead>
              {data.closingWindows.length === 0 ? (
                <p className="text-sm text-text-3">Ninguna conversación esperando respuesta.</p>
              ) : (
                <ul className="divide-y text-sm">
                  {data.closingWindows.map((c) => (
                    <li key={c.conversationId}>
                      <Link
                        href={`/inbox?contact=${c.contactId}`}
                        className="-mx-1 flex min-h-11 items-center justify-between gap-2 rounded-sm px-1 hover:bg-accent hover:underline"
                      >
                        <span className="min-w-0 truncate text-brand-text">{c.name}</span>
                        <span className="flex shrink-0 items-center gap-1 text-xs text-warning-text tabular-nums">
                          quedan {horasMinutos(c.hoursLeft)}
                          <ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden />
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ))}
    </Section>
  );
}

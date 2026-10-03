"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Check } from "lucide-react";
import { stateLabelFor } from "@/lib/estado";
import { homeStatus } from "@/lib/centro";
import type { StageCount } from "@/lib/embudo";
import type { Centro } from "@/server/agencia/estado";
import type { CentroMetricas } from "@/server/agencia/centro-metricas";
import type { Prioridades } from "@/server/agencia/prioridades";
import type { ReadinessResponse } from "@/server/readiness";
import { buttonVariants } from "@/components/ui/button";
import { AskBox } from "@/components/agencia/centro/ask-box";
import { MetricasSection } from "@/components/agencia/centro/metricas";
import { PrioridadesSection } from "@/components/agencia/centro/prioridades";
import { cn } from "@/lib/utils";
import { DayLine } from "./day-line";
import { StateDot } from "./mark";
import { useSystemRevision, useSystemState } from "./system-state";

/**
 * Inicio del SaaS allok: el centro de mando. Su trabajo es contestar «¿qué
 * atiendo ahora?»: arriba, cuántas conversaciones te necesitan; enseguida las
 * tarjetas de «Por dónde arrancar», la más urgente primero; después la
 * pregunta libre, las cifras del periodo y la línea del día. Mismas reglas que
 * el punto del logotipo (lib/estado) para el estado del sistema, así que nunca
 * se contradicen.
 */
export function ControlCenter({
  centro,
  prioridades,
  metricas,
  funnel,
  readiness,
  pro,
  billingNotice,
  businessName,
  userName,
  owner,
  brandId = "allok",
  productLabel = "allok",
}: {
  centro: Centro;
  prioridades: Prioridades;
  metricas: CentroMetricas;
  /** Los leads por etapa, ahora. */
  funnel: StageCount[];
  readiness: ReadinessResponse | null;
  /** Ventas, Agenda y Equipo (plan Completo activo). */
  pro: boolean;
  billingNotice?: string | null;
  businessName: string;
  userName: string;
  owner: boolean;
  /** Resueltos en el servidor (brand() no es NEXT_PUBLIC_): qué marca dibuja este centro de control. */
  brandId?: "allok" | "rei";
  productLabel?: string;
}) {
  const snapshot = useSystemState();
  const revision = useSystemRevision();
  const router = useRouter();

  // Cuando el estado se relee (llegó un mensaje, pasó un minuto), lo del día
  // también: una sola fuente de eventos para toda la pantalla. Refrescar
  // re-arma la página entera, así que va como mucho una vez cada 20 s.
  // ponytail: con cuentas grandes, un endpoint solo para las tarjetas y los números.
  const lastRefresh = useRef(0);
  useEffect(() => {
    if (revision === 0) return;
    const wait = Math.max(0, lastRefresh.current + 20_000 - Date.now());
    const timer = setTimeout(() => {
      lastRefresh.current = Date.now();
      router.refresh();
    }, wait);
    return () => clearTimeout(timer);
  }, [revision, router]);

  if (!snapshot) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center">
        <h1 className="text-xl font-semibold tracking-tight">Estamos preparando tu espacio</h1>
        <p className="mt-2 text-sm text-text-2">Todavía no hay datos para mostrar. Recarga en un momento o conecta tu WhatsApp desde Configuración.</p>
        <Link href="/settings/whatsapp" className="mt-5 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-brand-text hover:underline">
          Conectar WhatsApp <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    );
  }

  const status = homeStatus({
    snapshot,
    billingActive: centro.day.billingActive,
    agentOn: centro.day.agentOn,
    needsYou: prioridades.needsYou,
    live: prioridades.live,
    closed: prioridades.closed,
    productLabel,
    owner,
  });
  const tz = centro.timezone;
  const firstName = userName.trim().split(/\s+/)[0];
  const today = new Intl.DateTimeFormat("es", { weekday: "long", day: "numeric", month: "long", timeZone: tz }).format(new Date());
  // El saludo va con la hora del negocio, no con la del servidor.
  const hour = Number(new Intl.DateTimeFormat("en-US", { hour: "2-digit", hourCycle: "h23", timeZone: tz }).format(new Date()));
  const greeting = hour < 12 ? "Buenos días" : hour < 19 ? "Buenas tardes" : "Buenas noches";

  return (
    <div className="h-full overflow-y-auto bg-subtle">
      <div className="mx-auto w-full max-w-[1160px] px-4 pb-16 pt-6 md:px-8 md:pt-10">
        {billingNotice && (
          <p role="status" className="mb-6 rounded-md border border-info-soft bg-info-tint px-4 py-3 text-sm leading-relaxed text-info-text">
            {billingNotice}
          </p>
        )}

        <header>
          <p className="kicker" suppressHydrationWarning>{today}</p>
          <h1 suppressHydrationWarning className="mt-2 text-[30px] font-semibold leading-[1.05] tracking-[-0.035em] text-balance md:text-[38px]">
            {firstName ? `${greeting}, ${firstName}.` : `${greeting}.`}
          </h1>
          <p data-state={status.headline.state} className="mt-3 flex items-start gap-3 text-[16px] leading-snug md:text-[17px]">
            <StateDot state={status.headline.state} size={12} decorative motion className="mt-[5px] shrink-0" />
            <span className="text-balance">{status.headline.text}</span>
          </p>
        </header>

        {/* El estado del negocio, compacto. Tinta en los dos temas: es donde el punto se lee. */}
        <section
          aria-label="Estado de tu negocio"
          className="ak-ink mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[16px] border border-border bg-background px-4 py-3 shadow-md md:px-5"
        >
          <span className="flex items-center gap-2.5">
            <StateDot state={status.strip.state} size={10} decorative />
            <span className="text-[15px] font-semibold tracking-[-0.02em]">{stateLabelFor(status.strip.state, brandId)}</span>
          </span>
          <span className="font-mono text-[11.5px] text-text-3">{snapshot.whatsapp.phone ?? "Sin número conectado"}</span>
          <span className="kicker ml-auto hidden sm:inline">{businessName}</span>
          {(status.strip.reason || (status.strip.href && status.strip.actionLabel)) && (
            <div className="flex w-full flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t pt-3">
              {status.strip.reason && <p className="text-[14px] leading-snug text-text-2">{status.strip.reason}</p>}
              {status.strip.href && status.strip.actionLabel && (
                <Link href={status.strip.href} className={cn(buttonVariants({ size: "lg" }), "min-h-11 md:min-h-10")}>
                  {status.strip.actionLabel}
                  <ArrowRight className="h-4 w-4" strokeWidth={2} aria-hidden />
                </Link>
              )}
            </div>
          )}
        </section>

        <PrioridadesSection data={prioridades} productLabel={productLabel} connected={snapshot.whatsapp.status === "connected"} />

        <AskBox productLabel={productLabel} />

        <MetricasSection metricas={metricas} funnel={funnel} pro={pro} owner={owner} productLabel={productLabel} />

        {/* La firma de la pantalla: el día del negocio, hora por hora. */}
        <section aria-label="Hoy, hora por hora" className="ak-ink mt-5 overflow-hidden rounded-[22px] border border-border bg-background shadow-md">
          <DayLine day={centro.day} timezone={tz} owner={owner} productLabel={productLabel} />
        </section>

        {owner && readiness && <Readiness readiness={readiness} />}
      </div>
    </div>
  );
}

function Readiness({ readiness }: { readiness: ReadinessResponse }) {
  const done = readiness.steps.filter((s) => s.status === "complete").length;
  const next = readiness.steps.find((s) => s.status === "pending" || s.status === "stale");
  const complete = !next;
  const n = readiness.steps.length;
  const mdFill = (2 - (n % 2)) % 2;
  const xlFill = (3 - (n % 3)) % 3;
  return (
    <details open={!complete} className="group mt-5 overflow-hidden rounded-lg border bg-background">
      <summary className="flex cursor-pointer list-none items-center gap-4 px-5 py-4 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold tracking-[-0.01em]">
            {complete ? "Puesta en marcha completa" : "Puesta en marcha"}
          </span>
          <span className="mt-0.5 block text-[13px] text-text-3">
            {next ? `Siguiente: ${next.label}.` : "Tu agente tiene todo lo que necesita para atender."} Probar nunca le escribe a tus clientes.
          </span>
        </span>
        <span className="hidden w-40 items-center gap-3 sm:flex">
          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--ground-3)]">
            <span
              className="block h-full rounded-full bg-foreground"
              style={{ width: `${Math.round((done / readiness.steps.length) * 100)}%` }}
            />
          </span>
          <span className="font-mono text-[11px] text-text-3">
            {done}/{readiness.steps.length}
          </span>
        </span>
        <ArrowRight className="h-4 w-4 shrink-0 text-text-3 transition-transform group-open:rotate-90" aria-hidden />
      </summary>
      <ol className="grid gap-px border-t bg-border md:grid-cols-2 xl:grid-cols-3">
        {readiness.steps.map((step) => {
          const isNext = step.id === next?.id;
          return (
            <li key={step.id} className="bg-background">
              <Link
                href={step.href}
                aria-current={isNext ? "step" : undefined}
                className={cn(
                  "flex h-full gap-3 px-5 py-4 transition-colors hover:bg-[var(--bg-hover)]",
                  isNext && "bg-[var(--bg-hover)]",
                )}
              >
                <span
                  data-state={step.status === "complete" ? "activo" : isNext ? "atencion" : undefined}
                  className={cn(
                    "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px]",
                    step.status === "complete"
                      ? "border-transparent bg-[var(--st-soft)] text-[var(--st-ink)]"
                      : isNext
                        ? "border-[var(--st)] text-[var(--st-ink)]"
                        : "text-text-4",
                  )}
                >
                  {step.status === "complete" ? <Check className="h-3 w-3" strokeWidth={3} /> : step.status === "unavailable" ? "—" : "→"}
                </span>
                <span className="min-w-0">
                  <span className="block text-[14px] font-semibold">{step.label}</span>
                  <span className="mt-0.5 block text-[12.5px] leading-relaxed text-text-3">{step.detail}</span>
                </span>
              </Link>
            </li>
          );
        })}
        {/* Rellena la última fila: si no, el fondo de la rejilla asoma como un
            bloque gris donde falta un paso. */}
        {Array.from({ length: Math.max(xlFill, mdFill) }, (_, i) => (
          <li
            key={`fill-${i}`}
            aria-hidden
            className={cn("hidden bg-background", i < mdFill && "md:block", i < xlFill ? "xl:block" : "xl:hidden")}
          />
        ))}
      </ol>
    </details>
  );
}

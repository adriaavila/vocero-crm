"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { stateLabelFor } from "@/lib/estado";
import { homeStatus } from "@/lib/centro";
import type { StageCount } from "@/lib/embudo";
import { planHeadline, type PlanState } from "@/lib/plan-estado";
import { CheckoutReturn } from "@/components/agencia/checkout-return";
import { SetupProgressNav } from "@/components/agencia/setup-progress";
import { deriveSetupProgress, SETUP_STEP_CTA } from "@/lib/setup-steps";
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
  askRemaining,
  hasDecisions,
  readiness,
  pro,
  billingNotice,
  checkoutReturn = false,
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
  /** Preguntas libres que le quedan hoy al negocio (0: el campo nace deshabilitado). */
  askRemaining: number;
  /** El agente ya tomó alguna decisión: si no, no hay nada que revisar. */
  hasDecisions: boolean;
  readiness: ReadinessResponse | null;
  /** Ventas, Agenda y Equipo (plan Completo activo). */
  pro: boolean;
  billingNotice?: string | null;
  /** Vuelve de Checkout (`?billing=success`): Inicio espera la confirmación y se actualiza sola. */
  checkoutReturn?: boolean;
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
    capped: prioridades.capped,
    live: prioridades.live,
    closed: prioridades.closed,
    productLabel,
    owner,
    planKind: centro.plan.kind,
  });
  const tz = centro.timezone;
  const firstWord = (text: string) => text.trim().split(/\s+/)[0] ?? "";
  // Si el «nombre» es la primera palabra del negocio («Panadería»), saludar por él suena a error.
  const firstName = firstWord(userName).toLowerCase() === firstWord(businessName).toLowerCase() ? "" : firstWord(userName);
  const today = new Intl.DateTimeFormat("es", { weekday: "long", day: "numeric", month: "long", timeZone: tz }).format(new Date());
  // El saludo va con la hora del negocio, no con la del servidor.
  const hour = Number(new Intl.DateTimeFormat("en-US", { hour: "2-digit", hourCycle: "h23", timeZone: tz }).format(new Date()));
  const greeting = hour < 12 ? "Buenos días" : hour < 19 ? "Buenas tardes" : "Buenas noches";

  return (
    <div className="h-full overflow-y-auto bg-subtle">
      <div className="mx-auto w-full max-w-[1160px] px-4 pb-16 pt-6 md:px-8 md:pt-10">
        {checkoutReturn && (
          <CheckoutReturn settled={centro.plan.hasSubscription && centro.plan.agentAllowed} />
        )}
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
                <Link href={status.strip.href} className={cn(buttonVariants({ size: "lg" }), "min-h-11 [@media(pointer:fine)]:min-h-10")}>
                  {status.strip.actionLabel}
                  <ArrowRight className="h-4 w-4" strokeWidth={2} aria-hidden />
                </Link>
              )}
            </div>
          )}
        </section>

        <PlanStrip plan={centro.plan} timezone={tz} owner={owner} />

        <PrioridadesSection data={prioridades} productLabel={productLabel} connected={snapshot.whatsapp.status === "connected"} hasDecisions={hasDecisions} />

        <AskBox productLabel={productLabel} remainingToday={askRemaining} />

        {/* La firma de la pantalla: el día del negocio, hora por hora. */}
        <section aria-label="Hoy, hora por hora" className="ak-ink mt-5 overflow-hidden rounded-[22px] border border-border bg-background shadow-md">
          <DayLine day={centro.day} timezone={tz} owner={owner} productLabel={productLabel} />
        </section>

        <MetricasSection metricas={metricas} funnel={funnel} pro={pro} owner={owner} productLabel={productLabel} />

        {owner && readiness && <Readiness readiness={readiness} />}
      </div>
    </div>
  );
}

/**
 * La prueba gratis y el plan por cancelarse, en una línea: cuánto queda y la
 * única acción. Lo que ya frena al agente (prueba vencida, tope, cobro fallido)
 * no sale acá: lo dice el estado de arriba, con su botón.
 */
function PlanStrip({ plan, timezone, owner }: { plan: PlanState; timezone: string; owner: boolean }) {
  const trial = plan.kind === "trial" || plan.kind === "trial_ending";
  if (!trial && plan.kind !== "cancelling") return null;
  const ending = plan.kind === "trial_ending";
  const pct = plan.replies ? Math.round((plan.replies.used / plan.replies.cap) * 100) : 0;
  return (
    <section aria-label="Tu plan" className="mt-3 flex flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-[16px] border bg-background px-4 py-3 md:px-5">
      <div className="min-w-0">
        {ending && (
          <p className="mb-1 flex items-center gap-2.5 text-[15px] font-semibold">
            <StateDot state="atencion" size={9} decorative />
            Termina pronto
          </p>
        )}
        <p className="text-[15px] leading-relaxed text-text-2" suppressHydrationWarning>
          {planHeadline(plan, timezone)}
        </p>
        {trial && plan.replies && (
          <div className="mt-2 flex items-center gap-3">
            <div
              role="progressbar"
              aria-label="Respuestas de la prueba usadas"
              aria-valuemin={0}
              aria-valuemax={plan.replies.cap}
              aria-valuenow={plan.replies.used}
              className="h-1.5 w-40 overflow-hidden rounded-full bg-[var(--ground-3)]"
            >
              <div className="h-full rounded-full bg-foreground" style={{ width: `${pct}%` }} />
            </div>
            <span className="font-mono text-[11px] tabular-nums text-text-3">
              {plan.replies.used}/{plan.replies.cap} respuestas
            </span>
          </div>
        )}
      </div>
      {owner && (
        <Link
          href="/settings/billing"
          className="inline-flex min-h-11 items-center gap-2 rounded-[10px] border border-border-strong px-4 text-sm font-semibold transition-[border-color,transform] hover:border-foreground active:scale-[0.97]"
        >
          {plan.kind === "cancelling" ? "Gestionar plan" : "Elegir plan"}
          <ArrowRight className="h-4 w-4" strokeWidth={2} aria-hidden />
        </Link>
      )}
    </section>
  );
}

/**
 * La puesta en marcha en Inicio: los MISMOS cuatro pasos que Tu agente, Probar
 * y WhatsApp (`lib/setup-steps`, derivados de la preparación que ya cargó la
 * página), en vez de su propio contador de 7 u 8. Con el agente apagado nunca
 * dice «completa»: lo último que falta es encenderlo. Con el agente activo no
 * hay asistente de alta; si algo quedó viejo (la prueba, la conexión), una línea.
 */
function Readiness({ readiness }: { readiness: ReadinessResponse }) {
  const progress = deriveSetupProgress(readiness);
  const current = progress.steps.find((step) => step.key === progress.current);
  if (!current) return null;

  if (!progress.active) {
    return (
      <p className="mt-5 text-[13px] text-text-3">
        Por revisar:{" "}
        <Link href={current.href} className="font-semibold text-foreground underline-offset-2 hover:underline">
          {current.label}
        </Link>
        .
      </p>
    );
  }
  return (
    <section aria-labelledby="puesta-en-marcha" className="mt-5 rounded-lg border bg-background p-5">
      <h2 id="puesta-en-marcha" className="text-[15px] font-semibold tracking-[-0.01em]">
        Puesta en marcha
      </h2>
      <p className="mt-0.5 text-[13px] text-text-3">
        Siguiente: {current.label.toLowerCase()}. Probar nunca le escribe a tus clientes.
      </p>
      <SetupProgressNav progress={progress} className="mt-4 max-w-2xl" />
      <Link
        href={current.href}
        className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-[10px] bg-primary px-4 text-sm font-semibold text-primary-foreground transition-[transform] active:scale-[0.97]"
      >
        {SETUP_STEP_CTA[current.key]} <ArrowRight className="h-4 w-4" aria-hidden />
      </Link>
    </section>
  );
}

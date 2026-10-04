"use client";

import { useState } from "react";
import { ArrowRight, Check, CreditCard, ExternalLink } from "lucide-react";
import { StateDot } from "@/components/agencia/allok/mark";
import { useBillingSync } from "@/components/agencia/checkout-return";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { SystemState } from "@/lib/estado";
import { planCanCheckout, planDate, planHeadline, type PlanKind, type PlanState } from "@/lib/plan-estado";
import { PLAN_CATALOG } from "@/lib/saas-plans";
import type { SaaSBillingState, SaaSPlan } from "@/server/saas/billing";

const GRID_COLS: Record<number, string> = {
  1: "md:grid-cols-1",
  2: "md:grid-cols-2",
  3: "md:grid-cols-3",
};

/** Esencial solo contesta fuera del horario; durante la prueba (Completo, todo el día) el dueño debe saberlo antes de elegirlo. */
export const BASIC_DURING_TRIAL_NOTE = "Desde hoy tu agente contesta solo fuera de tu horario.";

/** Punto + palabra de cada punto del plan. El color es el estado, no un adorno. */
const KIND_STATUS: Record<PlanKind, { dot: SystemState; word: string } | null> = {
  trial: { dot: "activo", word: "En prueba" },
  trial_ending: { dot: "atencion", word: "La prueba termina pronto" },
  trial_cap: { dot: "atencion", word: "Prueba pausada" },
  trial_ended: { dot: "atencion", word: "La prueba terminó" },
  payment_failed: { dot: "atencion", word: "Pago pendiente" },
  canceled: { dot: "pausado", word: "Plan cancelado" },
  cancelling: { dot: "activo", word: "Plan activo" },
  paid: { dot: "activo", word: "Plan activo" },
  none: null,
};

export function BillingClient({
  billing,
  plan: planState,
  notice = null,
  soldPlans,
  brandName,
  trial = true,
  portalReturn = false,
}: {
  billing: SaaSBillingState;
  /** En qué punto del plan está el negocio: una sola lectura para todo lo de abajo. */
  plan: PlanState;
  notice?: string | null;
  soldPlans: SaaSPlan[];
  /** "Allok" / "Rei", resuelto en el servidor (`brand()` no es NEXT_PUBLIC_). */
  brandName: string;
  /** Rei no tiene prueba gratis: nunca muestra la tarjeta ni el copy de prueba. */
  trial?: boolean;
  /** Vuelve del portal de Stripe: espera a que el cambio llegue y recarga. */
  portalReturn?: boolean;
}) {
  const [loading, setLoading] = useState<SaaSPlan | "portal" | null>(null);
  const [error, setError] = useState<string | null>(null);
  useBillingSync({ enabled: portalReturn, knownUpdatedAt: billing.updatedAt });

  const kind = planState.kind;
  const status = KIND_STATUS[kind];
  const freeTrial = kind === "trial" || kind === "trial_ending";
  const showGrid = planCanCheckout(planState);
  const canPortal = planState.hasSubscription && billing.customerId !== null;
  const planName = billing.plan ? PLAN_CATALOG[billing.plan].name : brandName;
  const endDate = planDate(planState.endsAt);

  const title =
    kind === "trial" || kind === "trial_ending"
      ? "Prueba gratis de Completo"
      : kind === "trial_cap"
        ? "Usaste las respuestas de la prueba"
        : kind === "trial_ended"
          ? "Tu prueba terminó"
          : kind === "payment_failed"
            ? "No pudimos cobrar tu plan"
            : kind === "canceled"
              ? "Cancelaste tu plan"
              : kind === "cancelling"
                ? `Plan ${planName} hasta el ${endDate ?? "final del periodo"}`
                : `Plan ${planName} activo`;

  // Qué se dice debajo del título, por punto del plan.
  const detail =
    kind === "paid"
      ? billing.currentPeriodEnd
        ? `Próxima renovación: ${planDate(billing.currentPeriodEnd)}.`
        : "Tu agente está habilitado."
      : kind === "trial" || kind === "trial_ending"
        ? `${planHeadline(planState)} ${
            // Igual que selfServeTrialEnd: con menos de 49 h, Stripe cobra ya.
            planState.endsAt && Date.parse(planState.endsAt) - Date.now() > 49 * 3600 * 1000
              ? "Si eliges un plan ahora, el cobro empieza cuando termine la prueba."
              : ""
          }`.trim()
        : planHeadline(planState);

  async function goToCheckout(id: SaaSPlan) {
    setLoading(id);
    setError(null);
    try {
      const response = await fetch("/api/saas/billing/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ plan: id }),
      });
      const payload = (await response.json().catch(() => null)) as { url?: string; error?: { message?: string } } | null;
      if (!response.ok || !payload?.url) {
        setError(payload?.error?.message ?? "No se pudo abrir el pago. Inténtalo de nuevo.");
        setLoading(null);
        return;
      }
      window.location.assign(payload.url);
    } catch {
      setError("No pudimos conectar. Revisa tu internet y vuelve a intentarlo.");
      setLoading(null);
    }
  }

  async function openPortal() {
    setLoading("portal");
    setError(null);
    try {
      const response = await fetch("/api/saas/billing/portal", { method: "POST" });
      const payload = (await response.json().catch(() => null)) as { url?: string; error?: { message?: string } } | null;
      if (!response.ok || !payload?.url) {
        setError(payload?.error?.message ?? "No se pudo abrir el portal. Inténtalo de nuevo.");
        setLoading(null);
        return;
      }
      window.location.assign(payload.url);
    } catch {
      setError("No pudimos conectar. Revisa tu internet y vuelve a intentarlo.");
      setLoading(null);
    }
  }

  const portalLabel = kind === "payment_failed" ? "Actualizar pago" : kind === "cancelling" ? "Gestionar plan" : "Cambiar plan o cancelar";
  const gridTitle = freeTrial ? "Elige tu plan" : kind === "none" ? "Elige cómo empezar" : "Elige un plan para continuar";

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      {notice && kind !== "paid" && (
        <p role="alert" className="rounded-md border border-warning-soft bg-warning-tint px-3 py-2 text-sm text-warning-text">{notice}</p>
      )}
      <div>
        <p className="kicker">{trial ? `${brandName} SaaS` : "Tu plan"}</p>
        <h1 className="mt-1 text-2xl font-[700] tracking-tight">Facturación</h1>
        <p className="mt-1 text-sm text-text-2">Gestiona tu plan sin salir de Stripe. Tus conversaciones e historial se conservan aunque pauses la automatización.</p>
      </div>

      {status && (
        <section aria-labelledby="plan-status" className="rounded-lg border bg-background p-5">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-[13px] font-semibold text-text-2">
                <StateDot state={status.dot} size={9} decorative />
                {status.word}
              </p>
              <h2 id="plan-status" className="mt-1.5 text-lg font-semibold tracking-tight">{title}</h2>
            </div>
            {canPortal && (kind === "payment_failed" || kind === "paid" || kind === "cancelling") && (
              <Button
                variant={kind === "payment_failed" ? "default" : "outline"}
                className="min-h-11"
                onClick={() => void openPortal()}
                disabled={loading !== null}
              >
                {loading === "portal" ? "Abriendo…" : <>{portalLabel} <ExternalLink className="h-4 w-4" aria-hidden /></>}
              </Button>
            )}
          </div>
          <p className="mt-2 max-w-[62ch] text-sm leading-relaxed text-text-2">{detail}</p>
          {planState.replies && (
            <div className="mt-3 flex items-center gap-3">
              <div
                role="progressbar"
                aria-label="Respuestas de la prueba usadas"
                aria-valuemin={0}
                aria-valuemax={planState.replies.cap}
                aria-valuenow={planState.replies.used}
                className="h-1.5 w-44 overflow-hidden rounded-full bg-[var(--ground-3)]"
              >
                <div
                  className="h-full rounded-full bg-foreground"
                  style={{ width: `${Math.round((planState.replies.used / planState.replies.cap) * 100)}%` }}
                />
              </div>
              <span className="font-mono text-[11px] tabular-nums text-text-3">
                {planState.replies.used}/{planState.replies.cap} respuestas
              </span>
            </div>
          )}
        </section>
      )}

      {showGrid && (
        <Card>
          <CardHeader>
            <CardTitle>{gridTitle}</CardTitle>
            <CardDescription>Pagas en Stripe. Tu plan se activa cuando se confirma el pago.</CardDescription>
          </CardHeader>
          <CardContent className={`grid gap-4 ${GRID_COLS[soldPlans.length] ?? "md:grid-cols-2"}`}>
            {soldPlans.map((id) => {
              const plan = PLAN_CATALOG[id];
              return (
                <div key={plan.id} className={`flex flex-col rounded-lg border p-5 ${billing.plan === plan.id && !freeTrial ? "border-brand bg-brand-tint" : "bg-background"}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-lg font-semibold">{plan.name}</p>
                      <p className="mt-1 text-2xl font-[700] tracking-tight">${plan.priceUsd}/mes</p>
                    </div>
                    {plan.id === "pro" && <Badge variant="success">Más elegido</Badge>}
                  </div>
                  <p className="mt-3 text-sm leading-6 text-text-2">{plan.tagline}</p>
                  <ul className="mt-4 space-y-2 text-sm text-text-2">
                    {plan.features.map((feature) => (
                      <li key={feature} className="flex items-center gap-2"><Check className="h-3.5 w-3.5 shrink-0 text-success" aria-hidden />{feature}</li>
                    ))}
                  </ul>
                  <div className="mt-4 rounded-md border bg-subtle px-3 py-2.5">
                    <p className="kicker">Cuándo contesta</p>
                    <p className="mt-1 text-sm leading-snug text-foreground">{plan.answers}</p>
                  </div>
                  {freeTrial && plan.id === "basic" && (
                    <p className="mt-3 text-sm font-medium leading-snug text-foreground">{BASIC_DURING_TRIAL_NOTE}</p>
                  )}
                  <Button className="mt-5 min-h-11 w-full" variant={plan.id === "pro" ? "default" : "outline"} onClick={() => void goToCheckout(plan.id)} disabled={loading !== null}>
                    {loading === plan.id ? "Abriendo el pago…" : <>Elegir {plan.name}<ArrowRight className="ml-2 h-4 w-4" aria-hidden /></>}
                  </Button>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {error && <p role="alert" className="rounded-md border border-danger-soft bg-danger-tint px-3 py-2 text-sm text-danger-text">{error}</p>}
      <p className="flex items-center gap-2 text-xs text-text-3"><CreditCard className="h-4 w-4" aria-hidden /> Los pagos y métodos de pago se gestionan en Stripe.</p>
    </div>
  );
}

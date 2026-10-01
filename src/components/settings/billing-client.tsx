"use client";

import { useState } from "react";
import { ArrowRight, Check, CreditCard, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { billingStatusLabel, PLAN_CATALOG } from "@/lib/saas-plans";
import type { SaaSBillingState, SaaSPlan } from "@/server/saas/billing";

const GRID_COLS: Record<number, string> = {
  1: "md:grid-cols-1",
  2: "md:grid-cols-2",
  3: "md:grid-cols-3",
};

export function BillingClient({
  billing,
  notice = null,
  soldPlans,
}: {
  billing: SaaSBillingState;
  notice?: string | null;
  soldPlans: SaaSPlan[];
}) {
  const [loading, setLoading] = useState<SaaSPlan | "portal" | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Prueba de autoservicio (sin Stripe): se muestra cuándo termina y los
  // planes para pagar antes o al terminar.
  const freeTrial =
    billing.source === "self_serve_trial" && !billing.subscriptionId && billing.status === "trialing";
  const active = (billing.status === "active" || billing.status === "trialing") && !freeTrial;
  const statusCopy = {
    incomplete: "El checkout todavía no terminó de confirmar la suscripción.",
    past_due: "El último cobro no pudo procesarse. Actualiza tu método de pago para reactivar Allok.",
    unpaid: "La suscripción está impaga y la automatización permanece pausada.",
    canceled: "La suscripción está cancelada. Tus conversaciones e historial se conservan.",
    inactive: "No hay una suscripción activa.",
    active: "",
    trialing: "",
  }[billing.status];

  async function goToCheckout(plan: SaaSPlan) {
    setLoading(plan);
    setError(null);
    const response = await fetch("/api/saas/billing/checkout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ plan }),
    });
    const payload = (await response.json().catch(() => null)) as { url?: string; error?: { message?: string } } | null;
    if (!response.ok || !payload?.url) {
      setError(payload?.error?.message ?? "No se pudo abrir el checkout.");
      setLoading(null);
      return;
    }
    window.location.assign(payload.url);
  }

  async function openPortal() {
    setLoading("portal");
    setError(null);
    const response = await fetch("/api/saas/billing/portal", { method: "POST" });
    const payload = (await response.json().catch(() => null)) as { url?: string; error?: { message?: string } } | null;
    if (!response.ok || !payload?.url) {
      setError(payload?.error?.message ?? "No se pudo abrir el portal.");
      setLoading(null);
      return;
    }
    window.location.assign(payload.url);
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      {notice && !active && <p className="rounded-md border border-warning-soft bg-warning-tint px-3 py-2 text-sm text-warning-text">{notice}</p>}
      <div><p className="kicker">Allok SaaS</p><h1 className="mt-1 text-2xl font-[700] tracking-tight">Facturación</h1><p className="mt-1 text-sm text-text-2">Gestiona tu plan sin salir de Stripe. Tus conversaciones e historial se conservan aunque pauses la automatización.</p></div>
      {freeTrial && (
        <Card className="border-brand-soft bg-brand-tint">
          <CardContent className="p-5">
            <p className="font-semibold">Prueba gratis de Completo</p>
            <p className="mt-1 text-sm text-text-2">
              {billing.currentPeriodEnd
                ? `Termina el ${new Date(billing.currentPeriodEnd).toLocaleDateString("es-VE")}. Elige un plan para seguir cuando termine.`
                : "Elige un plan para seguir cuando termine."}
            </p>
          </CardContent>
        </Card>
      )}
      {active && <Card className="border-success-soft bg-success-tint"><CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-start gap-3"><span className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-full bg-success text-white"><Check className="h-4 w-4" /></span><div><p className="font-semibold">Plan {billing.plan ? PLAN_CATALOG[billing.plan].name : "Allok"} activo</p><p className="mt-1 text-sm text-success-text">{billing.cancelAtPeriodEnd && billing.currentPeriodEnd ? `Finaliza el ${new Date(billing.currentPeriodEnd).toLocaleDateString("es-VE")}.` : billing.currentPeriodEnd ? `Próxima renovación: ${new Date(billing.currentPeriodEnd).toLocaleDateString("es-VE")}.` : "La automatización está habilitada."}</p></div></div>{billing.subscriptionId && <Button variant="outline" onClick={() => void openPortal()} disabled={loading !== null}>{loading === "portal" ? "Abriendo…" : <>Gestionar facturación <ExternalLink className="ml-2 h-4 w-4" /></>}</Button>}</CardContent></Card>}
      {!active && !freeTrial && billing.status !== "inactive" && <Card className="border-warning-soft bg-warning-tint"><CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between"><div><Badge variant="warning">{billingStatusLabel(billing.status)}</Badge><p className="mt-2 text-sm text-warning-text">{statusCopy}</p></div>{billing.subscriptionId && <Button variant="outline" onClick={() => void openPortal()} disabled={loading !== null}>{loading === "portal" ? "Abriendo…" : <>Actualizar pago <ExternalLink className="ml-2 h-4 w-4" /></>}</Button>}</CardContent></Card>}
      {!active && <Card><CardHeader><CardTitle>{freeTrial ? "Elige tu plan" : billing.status === "inactive" ? "Elige cómo empezar" : "Elige un plan para continuar"}</CardTitle><CardDescription>Checkout alojado por Stripe. No se activa nada hasta que el pago sea confirmado por webhook.</CardDescription></CardHeader><CardContent className={`grid gap-4 ${GRID_COLS[soldPlans.length] ?? "md:grid-cols-2"}`}>{soldPlans.map((id) => { const plan = PLAN_CATALOG[id]; return <div key={plan.id} className={`rounded-lg border p-5 ${billing.plan === plan.id ? "border-brand bg-brand-tint" : "bg-background"}`}><div className="flex items-start justify-between gap-3"><div><p className="text-lg font-semibold">{plan.name}</p><p className="mt-1 text-2xl font-[700] tracking-tight">${plan.priceUsd}/mes</p></div>{plan.id === "pro" && <Badge variant="success">Más elegido</Badge>}</div><p className="mt-3 text-sm leading-6 text-text-2">{plan.tagline}</p><ul className="mt-4 space-y-2 text-sm text-text-2">{plan.features.map((feature) => <li key={feature} className="flex items-center gap-2"><Check className="h-3.5 w-3.5 text-success" />{feature}</li>)}</ul><Button className="mt-5 w-full" variant={plan.id === "pro" ? "default" : "outline"} onClick={() => void goToCheckout(plan.id)} disabled={loading !== null}>{loading === plan.id ? "Abriendo checkout…" : <>Elegir {plan.name}<ArrowRight className="ml-2 h-4 w-4" /></>}</Button></div>; })}</CardContent></Card>}
      {error && <p className="rounded-md border border-danger-soft bg-danger-tint px-3 py-2 text-sm text-danger-text">{error}</p>}
      <p className="flex items-center gap-2 text-xs text-text-3"><CreditCard className="h-4 w-4" /> Los pagos y métodos de pago se gestionan en Stripe.</p>
    </div>
  );
}

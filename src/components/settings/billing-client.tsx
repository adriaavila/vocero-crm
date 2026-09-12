"use client";

import { useState } from "react";
import { ArrowRight, Check, CreditCard, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { SaaSBillingState, SaaSPlan } from "@/server/saas/billing";

const plans: { id: SaaSPlan; name: string; price: string; description: string; features: string[] }[] = [
  { id: "basic", name: "Básico", price: "$29/mes", description: "Para responder fuera de horario y no perder conversaciones.", features: ["1 número de WhatsApp", "Agente y horarios", "Historial y pruebas"] },
  { id: "pro", name: "Pro", price: "$99/mes", description: "Para convertir conversaciones en oportunidades.", features: ["Todo lo de Básico", "Pipeline y agenda", "Hasta 3 usuarios"] },
];

export function BillingClient({ billing }: { billing: SaaSBillingState }) {
  const [loading, setLoading] = useState<SaaSPlan | "portal" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const active = billing.status === "active" || billing.status === "trialing";
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
      <div><p className="kicker">Allok SaaS</p><h1 className="mt-1 text-2xl font-[700] tracking-tight">Facturación</h1><p className="mt-1 text-sm text-text-2">Gestiona tu plan sin salir de Stripe. Tus conversaciones e historial se conservan aunque pauses la automatización.</p></div>
      {active && <Card className="border-success-soft bg-success-tint"><CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-start gap-3"><span className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-full bg-success text-white"><Check className="h-4 w-4" /></span><div><p className="font-semibold">Plan {billing.plan === "pro" ? "Pro" : "Básico"} activo</p><p className="mt-1 text-sm text-success-text">{billing.cancelAtPeriodEnd && billing.currentPeriodEnd ? `Finaliza el ${new Date(billing.currentPeriodEnd).toLocaleDateString("es-VE")}.` : billing.currentPeriodEnd ? `Próxima renovación: ${new Date(billing.currentPeriodEnd).toLocaleDateString("es-VE")}.` : "La automatización está habilitada."}</p></div></div><Button variant="outline" onClick={() => void openPortal()} disabled={loading !== null}>{loading === "portal" ? "Abriendo…" : <>Gestionar facturación <ExternalLink className="ml-2 h-4 w-4" /></>}</Button></CardContent></Card>}
      {!active && billing.status !== "inactive" && <Card className="border-warning-soft bg-warning-tint"><CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between"><div><Badge variant="warning">{billing.status.replace("_", " ")}</Badge><p className="mt-2 text-sm text-warning-text">{statusCopy}</p></div>{billing.customerId && <Button variant="outline" onClick={() => void openPortal()} disabled={loading !== null}>{loading === "portal" ? "Abriendo…" : <>Actualizar pago <ExternalLink className="ml-2 h-4 w-4" /></>}</Button>}</CardContent></Card>}
      {!active && <Card><CardHeader><CardTitle>{billing.status === "inactive" ? "Elige cómo empezar" : "Elige un plan para continuar"}</CardTitle><CardDescription>Checkout alojado por Stripe. No se activa nada hasta que el pago sea confirmado por webhook.</CardDescription></CardHeader><CardContent className="grid gap-4 md:grid-cols-2">{plans.map((plan) => <div key={plan.id} className={`rounded-lg border p-5 ${billing.plan === plan.id ? "border-brand bg-brand-tint" : "bg-background"}`}><div className="flex items-start justify-between gap-3"><div><p className="text-lg font-semibold">{plan.name}</p><p className="mt-1 text-2xl font-[700] tracking-tight">{plan.price}</p></div>{plan.id === "pro" && <Badge variant="success">Más elegido</Badge>}</div><p className="mt-3 text-sm leading-6 text-text-2">{plan.description}</p><ul className="mt-4 space-y-2 text-sm text-text-2">{plan.features.map((feature) => <li key={feature} className="flex items-center gap-2"><Check className="h-3.5 w-3.5 text-success" />{feature}</li>)}</ul><Button className="mt-5 w-full" variant={plan.id === "pro" ? "default" : "outline"} onClick={() => void goToCheckout(plan.id)} disabled={loading !== null}>{loading === plan.id ? "Abriendo checkout…" : <>Elegir {plan.name}<ArrowRight className="ml-2 h-4 w-4" /></>}</Button></div>)}</CardContent></Card>}
      {error && <p className="rounded-md border border-danger-soft bg-danger-tint px-3 py-2 text-sm text-danger-text">{error}</p>}
      <p className="flex items-center gap-2 text-xs text-text-3"><CreditCard className="h-4 w-4" /> Los pagos y métodos de pago se gestionan en Stripe. Configura impuestos antes de habilitar producción.</p>
      <p className="text-xs text-text-3">La configuración asistida opcional de $49 está desactivada por ahora y no se añadirá automáticamente.</p>
    </div>
  );
}

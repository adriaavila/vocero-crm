"use client";

import { useState } from "react";
import { Activity } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PLAN_CATALOG } from "@/lib/saas-plans";
import type { SaaSPlan } from "@/server/saas/billing";
import type { SaaSTenantStatus } from "@/server/saas/admin";

type Billing = SaaSTenantStatus["billing"];
type PendingAction = "grant" | "revoke" | null;

function planLabel(plan: SaaSPlan | null): string {
  return plan ? PLAN_CATALOG[plan].name : "—";
}

export function AdminTenantsTable({
  tenants: initialTenants,
  soldPlans,
}: {
  tenants: SaaSTenantStatus[];
  soldPlans: SaaSPlan[];
}) {
  const [tenants, setTenants] = useState(initialTenants);
  const [choice, setChoice] = useState<Record<string, SaaSPlan>>({});
  const [pending, setPending] = useState<Record<string, PendingAction>>({});
  const [needsConfirm, setNeedsConfirm] = useState<Record<string, "grant" | "revoke">>({});
  const [error, setError] = useState<Record<string, string>>({});

  function planFor(tenantId: string): SaaSPlan {
    return choice[tenantId] ?? soldPlans[0] ?? "basic";
  }

  function applyBilling(tenantId: string, billing: Billing) {
    setTenants((list) => list.map((t) => (t.id === tenantId ? { ...t, billing } : t)));
  }

  function clearConfirm(tenantId: string) {
    setNeedsConfirm((state) => {
      if (!(tenantId in state)) return state;
      const next = { ...state };
      delete next[tenantId];
      return next;
    });
  }

  async function grant(tenantId: string, confirmOverrideStripe = false) {
    setPending((state) => ({ ...state, [tenantId]: "grant" }));
    setError((state) => ({ ...state, [tenantId]: "" }));
    const response = await fetch(`/api/saas/businesses/${tenantId}/plan`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ plan: planFor(tenantId), confirmOverrideStripe }),
    }).catch(() => null);
    setPending((state) => ({ ...state, [tenantId]: null }));
    if (response?.status === 409) {
      setNeedsConfirm((state) => ({ ...state, [tenantId]: "grant" }));
      return;
    }
    const payload = (await response?.json().catch(() => null)) as
      { billing?: Billing; message?: string } | null;
    if (!response?.ok || !payload?.billing) {
      setError((state) => ({ ...state, [tenantId]: payload?.message ?? "No se pudo activar el plan." }));
      return;
    }
    clearConfirm(tenantId);
    applyBilling(tenantId, payload.billing);
  }

  async function revoke(tenantId: string, confirmOverrideStripe = false) {
    setPending((state) => ({ ...state, [tenantId]: "revoke" }));
    setError((state) => ({ ...state, [tenantId]: "" }));
    const response = await fetch(`/api/saas/businesses/${tenantId}/plan`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirmOverrideStripe }),
    }).catch(() => null);
    setPending((state) => ({ ...state, [tenantId]: null }));
    if (response?.status === 409) {
      setNeedsConfirm((state) => ({ ...state, [tenantId]: "revoke" }));
      return;
    }
    const payload = (await response?.json().catch(() => null)) as
      { billing?: Billing; message?: string } | null;
    if (!response?.ok || !payload?.billing) {
      setError((state) => ({ ...state, [tenantId]: payload?.message ?? "No se pudo quitar el plan." }));
      return;
    }
    clearConfirm(tenantId);
    applyBilling(tenantId, payload.billing);
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[980px] text-left text-sm">
        <thead className="border-b text-[11px] font-semibold uppercase tracking-[0.12em] text-text-3">
          <tr>
            <th className="px-5 py-3 font-semibold">Negocio</th>
            <th className="px-5 py-3 font-semibold">Plan</th>
            <th className="px-5 py-3 font-semibold">WhatsApp</th>
            <th className="px-5 py-3 font-semibold">Agente</th>
            <th className="px-5 py-3 font-semibold">Usuarios</th>
            <th className="px-5 py-3 font-semibold">Plan a mano</th>
          </tr>
        </thead>
        <tbody>
          {tenants.length ? tenants.map((tenant) => (
            <tr key={tenant.id} className="border-b align-top last:border-0">
              <td className="px-5 py-4">
                <p className="truncate font-semibold">{tenant.name}</p>
                <p className="mt-1 truncate font-mono text-xs text-text-3">{tenant.slug ?? tenant.id}</p>
              </td>
              <td className="px-5 py-4 text-text-2">
                {planLabel(tenant.billing.plan)}
                <span className="block text-xs text-text-3">{tenant.billing.status}</span>
                {tenant.billing.source && (
                  <span className="block text-[11px] text-text-4">{tenant.billing.source}</span>
                )}
              </td>
              <td className={tenant.whatsapp === "connected" ? "px-5 py-4 text-success-text" : "px-5 py-4 text-text-3"}>
                {tenant.whatsapp === "connected" ? "Conectado" : tenant.whatsapp === "reconnect_required" ? "Reconectar" : "Pendiente"}
              </td>
              <td className="px-5 py-4">
                <span className="flex items-center gap-1.5 text-text-2">
                  <Activity className={tenant.agentEnabled ? "h-3.5 w-3.5 text-success" : "h-3.5 w-3.5 text-text-4"} aria-hidden="true" />
                  {tenant.agentEnabled ? "Activo" : "Pausa"}
                </span>
              </td>
              <td className="px-5 py-4 text-text-2">{tenant.members}</td>
              <td className="px-5 py-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Select value={planFor(tenant.id)} onValueChange={(value) => setChoice((state) => ({ ...state, [tenant.id]: value as SaaSPlan }))}>
                    <SelectTrigger className="h-8 w-[140px] text-xs" aria-label={`Plan a conceder a ${tenant.name}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {soldPlans.map((id) => (
                        <SelectItem key={id} value={id}>{PLAN_CATALOG[id].name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending[tenant.id] === "grant"}
                    onClick={() => void grant(tenant.id)}
                  >
                    {pending[tenant.id] === "grant" ? "Activando…" : "Activar plan"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending[tenant.id] === "revoke" || !tenant.billing.plan}
                    onClick={() => void revoke(tenant.id)}
                  >
                    {pending[tenant.id] === "revoke" ? "Quitando…" : "Quitar plan"}
                  </Button>
                </div>
                {needsConfirm[tenant.id] && (
                  <div className="mt-2 max-w-sm rounded-md border border-warning-soft bg-warning-tint px-2.5 py-2 text-xs text-warning-text">
                    <p>
                      Este negocio ya tiene una suscripción de Stripe vigente.{" "}
                      {needsConfirm[tenant.id] === "grant"
                        ? "Cambiar el plan a mano no la cancela en Stripe."
                        : "Quitar el plan a mano no la cancela en Stripe."}{" "}
                      ¿Confirmas de todos modos?
                    </p>
                    <div className="mt-2 flex gap-2">
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => void (needsConfirm[tenant.id] === "grant" ? grant(tenant.id, true) : revoke(tenant.id, true))}
                      >
                        Sí, continuar
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => clearConfirm(tenant.id)}>
                        Cancelar
                      </Button>
                    </div>
                  </div>
                )}
                {error[tenant.id] && <p className="mt-1 max-w-sm text-xs text-danger-text">{error[tenant.id]}</p>}
              </td>
            </tr>
          )) : (
            <tr><td colSpan={6} className="px-5 py-12 text-center text-sm text-text-3">No hay negocios registrados.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { Activity } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { billingStatusLabel, formatManualSource, PLAN_CATALOG, PLAN_ORDER } from "@/lib/saas-plans";
import type { SaaSPlan } from "@/server/saas/billing";
import type { SaaSTenantStatus } from "@/server/saas/admin";

type Billing = SaaSTenantStatus["billing"];
type PendingAction = "grant" | "revoke" | null;

function planLabel(plan: SaaSPlan | null): string {
  return plan ? PLAN_CATALOG[plan].name : "—";
}

function whatsappLabel(status: SaaSTenantStatus["whatsapp"]): string {
  return status === "connected" ? "Conectado" : status === "reconnect_required" ? "Reconectar" : "Pendiente";
}

/** Nada que quitar: sin plan y sin nada activo. Con plan (aunque el estado sea raro) o con algo activo, "Quitar plan" queda habilitado. */
function nothingToRevoke(billing: Billing): boolean {
  return !billing.plan && billing.status === "inactive";
}

/**
 * Fila por negocio, no tabla: con el selector de plan y dos botones por
 * fila, una tabla obliga a scroll horizontal en 375px para llegar a la
 * única acción que importa aquí. Este patrón (bloque que se apila en
 * móvil) ya lo usa `team-client.tsx` para listas con acciones por fila.
 */
export function AdminTenantsTable({ tenants: initialTenants }: { tenants: SaaSTenantStatus[] }) {
  const [tenants, setTenants] = useState(initialTenants);
  const [choice, setChoice] = useState<Record<string, SaaSPlan>>({});
  const [pending, setPending] = useState<Record<string, PendingAction>>({});
  const [needsConfirm, setNeedsConfirm] = useState<Record<string, "grant" | "revoke">>({});
  const [error, setError] = useState<Record<string, string>>({});
  const confirmButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  useEffect(() => {
    for (const tenantId of Object.keys(needsConfirm)) {
      confirmButtonRefs.current[tenantId]?.focus();
    }
    // Solo al aparecer un nuevo aviso, no en cada render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Object.keys(needsConfirm).join(",")]);

  function planFor(tenantId: string): SaaSPlan {
    return choice[tenantId] ?? PLAN_ORDER[0] ?? "basic";
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

  if (!tenants.length) {
    return <p className="px-5 py-12 text-center text-sm text-text-3">No hay negocios registrados.</p>;
  }

  return (
    <div className="divide-y">
      {tenants.map((tenant) => (
        <div key={tenant.id} className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate font-semibold">{tenant.name}</p>
              <p className="mt-1 truncate font-mono text-xs text-text-3">{tenant.slug ?? tenant.id}</p>
            </div>
            <div className="text-right text-sm text-text-2">
              {planLabel(tenant.billing.plan)}
              <span className="block text-xs text-text-3">{billingStatusLabel(tenant.billing.status)}</span>
              {tenant.billing.source && (
                <span className="block text-[11px] text-text-4">{formatManualSource(tenant.billing.source)}</span>
              )}
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-3">
            <span className={tenant.whatsapp === "connected" ? "text-success-text" : undefined}>
              WhatsApp: {whatsappLabel(tenant.whatsapp)}
            </span>
            <span className="flex items-center gap-1.5">
              <Activity className={tenant.agentEnabled ? "h-3.5 w-3.5 text-success" : "h-3.5 w-3.5 text-text-4"} aria-hidden="true" />
              Agente {tenant.agentEnabled ? "activo" : "en pausa"}
            </span>
            <span>{tenant.members} usuario{tenant.members === 1 ? "" : "s"}</span>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Select value={planFor(tenant.id)} onValueChange={(value) => setChoice((state) => ({ ...state, [tenant.id]: value as SaaSPlan }))}>
              <SelectTrigger className="h-11 w-[160px] text-xs" aria-label={`Plan a conceder a ${tenant.name}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PLAN_ORDER.map((id) => (
                  <SelectItem key={id} value={id}>{PLAN_CATALOG[id].name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              className="h-11"
              variant="outline"
              disabled={pending[tenant.id] === "grant"}
              onClick={() => void grant(tenant.id)}
            >
              {pending[tenant.id] === "grant" ? "Activando…" : "Activar plan"}
            </Button>
            <Button
              className="h-11"
              variant="ghost"
              disabled={pending[tenant.id] === "revoke" || nothingToRevoke(tenant.billing)}
              onClick={() => void revoke(tenant.id)}
            >
              {pending[tenant.id] === "revoke" ? "Quitando…" : "Quitar plan"}
            </Button>
          </div>

          {needsConfirm[tenant.id] && (
            <div role="alert" className="mt-3 rounded-md border border-warning-soft bg-warning-tint px-3 py-2.5 text-xs text-warning-text">
              <p>
                Este negocio ya tiene una suscripción de Stripe vigente. Confirmar{" "}
                {needsConfirm[tenant.id] === "grant" ? "el nuevo plan" : "quitarlo"} la desengancha acá, pero{" "}
                <strong>la suscripción de Stripe seguirá cobrando hasta que la canceles en Stripe.</strong> ¿Confirmas de todos modos?
              </p>
              <div className="mt-2 flex gap-2">
                <Button
                  ref={(node) => { confirmButtonRefs.current[tenant.id] = node; }}
                  className="h-11"
                  variant="destructive"
                  onClick={() => void (needsConfirm[tenant.id] === "grant" ? grant(tenant.id, true) : revoke(tenant.id, true))}
                >
                  Sí, continuar
                </Button>
                <Button className="h-11" variant="ghost" onClick={() => clearConfirm(tenant.id)}>
                  Cancelar
                </Button>
              </div>
            </div>
          )}
          {error[tenant.id] && (
            <p role="alert" aria-live="assertive" className="mt-2 text-xs text-danger-text">
              {error[tenant.id]}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

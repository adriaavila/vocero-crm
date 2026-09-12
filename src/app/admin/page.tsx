import { notFound } from "next/navigation";
import { Activity, MessageCircle, ShieldCheck } from "lucide-react";
import { listSaaSTenantStatus, requireSaaSAdmin, SaaSAdminUnauthorized } from "@/server/saas/admin";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  try {
    await requireSaaSAdmin();
  } catch (error) {
    if (error instanceof SaaSAdminUnauthorized) notFound();
    throw error;
  }
  const tenants = await listSaaSTenantStatus();
  return (
    <main className="min-h-dvh bg-subtle px-5 py-8 text-foreground sm:px-8">
      <div className="mx-auto max-w-6xl">
        <header className="flex flex-wrap items-end justify-between gap-4 border-b pb-6">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.16em] text-brand-text">Allok interno</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">Estado de clientes</h1>
            <p className="mt-2 text-sm text-text-2">Solo lectura. Sin impersonación ni cambios silenciosos.</p>
          </div>
          <div className="flex items-center gap-2 rounded-full border bg-background px-3 py-2 text-xs font-semibold text-success-text">
            <ShieldCheck className="h-4 w-4" aria-hidden="true" /> Acceso auditado
          </div>
        </header>

        <section className="mt-6 overflow-hidden rounded-xl border bg-background shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="border-b text-[11px] font-semibold uppercase tracking-[0.12em] text-text-3">
                <tr><th className="px-5 py-3 font-semibold">Negocio</th><th className="px-5 py-3 font-semibold">Plan</th><th className="px-5 py-3 font-semibold">WhatsApp</th><th className="px-5 py-3 font-semibold">Agente</th><th className="px-5 py-3 font-semibold">Usuarios</th></tr>
              </thead>
              <tbody>
                {tenants.length ? tenants.map((tenant) => (
                  <tr key={tenant.id} className="border-b last:border-0">
                    <td className="px-5 py-4"><p className="truncate font-semibold">{tenant.name}</p><p className="mt-1 truncate font-mono text-xs text-text-3">{tenant.slug ?? tenant.id}</p></td>
                    <td className="px-5 py-4 capitalize text-text-2">{tenant.billing.plan ?? "—"}<span className="block text-xs text-text-3">{tenant.billing.status}</span></td>
                    <td className={tenant.whatsapp === "connected" ? "px-5 py-4 text-success-text" : "px-5 py-4 text-text-3"}>{tenant.whatsapp === "connected" ? "Conectado" : tenant.whatsapp === "reconnect_required" ? "Reconectar" : "Pendiente"}</td>
                    <td className="px-5 py-4"><span className="flex items-center gap-1.5 text-text-2"><Activity className={tenant.agentEnabled ? "h-3.5 w-3.5 text-success" : "h-3.5 w-3.5 text-text-4"} aria-hidden="true" />{tenant.agentEnabled ? "Activo" : "Pausa"}</span></td>
                    <td className="px-5 py-4 text-text-2">{tenant.members}</td>
                  </tr>
                )) : <tr><td colSpan={5} className="px-5 py-12 text-center text-sm text-text-3">No hay negocios registrados.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>

        <footer className="mt-5 flex items-center gap-2 text-xs text-text-3"><MessageCircle className="h-3.5 w-3.5" aria-hidden="true" /> Última lectura: {new Date().toLocaleString("es-VE")}</footer>
      </div>
    </main>
  );
}

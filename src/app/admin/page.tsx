import { notFound } from "next/navigation";
import { MessageCircle, ShieldCheck } from "lucide-react";
import { soldSaaSPlans } from "@/lib/saas-plans";
import { AdminTenantsTable } from "@/components/admin/tenants-table";
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
  const soldPlans = soldSaaSPlans(process.env.SAAS_PLANS);
  return (
    <main className="min-h-dvh bg-subtle px-5 py-8 text-foreground sm:px-8">
      <div className="mx-auto max-w-6xl">
        <header className="flex flex-wrap items-end justify-between gap-4 border-b pb-6">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.16em] text-brand-text">Allok interno</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">Estado de clientes</h1>
            <p className="mt-2 text-sm text-text-2">Cambiar un plan a mano queda auditado. Nunca pisa una suscripción de Stripe vigente sin confirmarlo.</p>
          </div>
          <div className="flex items-center gap-2 rounded-full border bg-background px-3 py-2 text-xs font-semibold text-success-text">
            <ShieldCheck className="h-4 w-4" aria-hidden="true" /> Acceso auditado
          </div>
        </header>

        <section className="mt-6 overflow-hidden rounded-xl border bg-background shadow-sm">
          <AdminTenantsTable tenants={tenants} soldPlans={soldPlans} />
        </section>

        <footer className="mt-5 flex items-center gap-2 text-xs text-text-3"><MessageCircle className="h-3.5 w-3.5" aria-hidden="true" /> Última lectura: {new Date().toLocaleString("es-VE")}</footer>
      </div>
    </main>
  );
}

import { headers } from "next/headers";
import { getAuth } from "@/lib/auth";
import { requireSession } from "@/lib/auth/session";
import { OverviewDashboard } from "@/components/overview/overview-dashboard";
import { getOverview } from "@/server/overview";
import { listConversations } from "@/server/inbox/queries";
import { getReadiness } from "@/server/readiness";
import { isAllokSaaSMode } from "@/lib/tenant-host";
import { planMeetsTier } from "@/lib/saas-plans";
import { getOrganizationBilling } from "@/server/saas/billing";
import { getBranding } from "@/server/branding";
import { brand } from "@/lib/brand";
import { agentOn, getCentro } from "@/server/agencia/estado";
import { getCentroMetricas, parsePeriod, pipelineNow } from "@/server/agencia/centro-metricas";
import { getPrioridades } from "@/server/agencia/prioridades";
import { ControlCenter } from "@/components/agencia/allok/control-center";

export const dynamic = "force-dynamic";

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ billing?: string; upgrade?: string; p?: string }>;
}) {
  const params = await searchParams;
  const session = await requireSession();
  // En el SaaS la lista alimenta la línea del día: se carga una sola vez.
  const conversations = isAllokSaaSMode() ? await listConversations(session.organizationId) : undefined;
  const [overview, readiness, authSession, billing] = await Promise.all([
    // En el SaaS, Inicio ya no usa este resumen: sus cifras son de agencia/centro-metricas.
    isAllokSaaSMode() ? Promise.resolve(null) : getOverview(session.organizationId),
    session.role === "owner" ? getReadiness(session.organizationId) : null,
    getAuth().api.getSession({ headers: await headers() }),
    isAllokSaaSMode() ? getOrganizationBilling(session.organizationId) : null,
  ]);
  const billingNotice = params.billing === "success"
    ? "Checkout completado. Stripe está confirmando la suscripción; la automatización se habilitará solo cuando llegue el webhook."
    : params.billing === "cancelled"
      ? "No se realizó ningún cobro. Puedes retomar el checkout desde Facturación cuando quieras."
      : params.upgrade === "pro"
        ? "Ventas, Agenda, Equipo y Resultados están incluidos en Completo. Puedes comparar los planes y activar el upgrade desde Facturación."
      : params.billing === "unavailable" && isAllokSaaSMode()
        ? `Tu espacio está listo, pero Facturación todavía no está configurada. Puedes continuar preparando ${brand().Name} y volver a intentarlo desde Facturación.`
      : null;
  if (isAllokSaaSMode()) {
    // Capa de agencia: en el SaaS, Inicio es el centro de control de allok.fun.
    const orgId = session.organizationId;
    const [centro, branding, metricas, funnel, prioridades] = await Promise.all([
      getCentro(orgId, conversations ?? []),
      getBranding(orgId),
      getCentroMetricas(orgId, parsePeriod(params.p)),
      pipelineNow(orgId),
      agentOn(orgId).then((agent) => getPrioridades(orgId, { agentOn: agent.on })),
    ]);
    const pro = planMeetsTier(billing?.plan, "pro") && (billing?.status === "active" || billing?.status === "trialing");
    return (
      <ControlCenter
        centro={centro}
        prioridades={prioridades}
        metricas={metricas}
        funnel={funnel}
        readiness={readiness}
        pro={pro}
        billingNotice={billingNotice}
        businessName={branding.name}
        userName={authSession?.user.name ?? ""}
        owner={session.role === "owner"}
        brandId={brand().id}
        productLabel={brand().name}
      />
    );
  }
  if (!overview) throw new Error("Inicio: falta el resumen fuera del SaaS");
  return <OverviewDashboard data={overview} readiness={readiness} billing={billing} billingNotice={billingNotice} userName={authSession?.user.name ?? ""} owner={session.role === "owner"} />;
}

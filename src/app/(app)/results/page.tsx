import { redirect } from "next/navigation";
import { requireOwnerSession } from "@/lib/auth/session";
import { hasSaaSPlan } from "@/server/agencia/entitlements";
import { todayInTz } from "@/lib/time/slots";
import { getBranding } from "@/server/branding";
import { agendaEnabled } from "@/server/agenda/flag";
import { businessTimezone } from "@/server/analytics/period";
import { ResultsClient } from "@/components/results/results-client";

export const dynamic = "force-dynamic";

/**
 * 019 (upstream) — Resultados. Siempre disponible ahí: no depende de nada
 * externo, así que no lleva bandera (spec 019, D3).
 *
 * Fork — Solo el propietario, como Agente, Laboratorio y Analítica (a la que
 * reemplaza en el nav); en SaaS, además el plan Completo, como Pipeline
 * (`hasSaaSPlan` es un no-op fuera de modo SaaS). Asunción de producto: leads
 * y resultados son una función de Completo — avisar en el PR por si el dueño
 * decide otra cosa.
 *
 * Moneda, zona y "hoy" se resuelven en el servidor y bajan como props: si los
 * pidiera el cliente, la pantalla pintaría un instante con la moneda o el día
 * equivocados, y los atajos del rango no coincidirían con los del servidor.
 */
export default async function ResultsPage() {
  const session = await requireOwnerSession();
  if (!(await hasSaaSPlan(session.organizationId, "pro"))) {
    redirect("/overview?upgrade=pro");
  }
  const [branding, timezone] = await Promise.all([
    getBranding(session.organizationId),
    businessTimezone(session.organizationId),
  ]);
  return (
    <ResultsClient
      currency={branding.currency}
      agenda={agendaEnabled()}
      today={todayInTz(new Date(), timezone)}
      timezone={timezone}
    />
  );
}

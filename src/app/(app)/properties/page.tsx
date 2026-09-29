import { notFound, redirect } from "next/navigation";
import { PropertiesClient } from "@/components/properties/properties-client";
import { requireSession } from "@/lib/auth/session";
import { hasSaaSPlan } from "@/server/agencia/entitlements";
import { isRealtyOrg } from "@/server/agencia/vertical";

export const dynamic = "force-dynamic";

/**
 * Vertical inmobiliario (parte 1). Sin la bandera de la organización, esta
 * pantalla no existe en esta instancia (mismo criterio que `/bookings` con
 * `AGENDA`): 404, no un aviso de "esto no aplica para ti".
 */
export default async function PropertiesPage() {
  const session = await requireSession();
  if (!(await isRealtyOrg(session.organizationId))) notFound();
  if (!(await hasSaaSPlan(session.organizationId, "pro"))) {
    redirect("/overview?upgrade=pro");
  }
  return <PropertiesClient />;
}

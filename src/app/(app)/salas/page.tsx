import { notFound, redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { hasSaaSPlan } from "@/server/agencia/entitlements";
import { isRealtyOrg } from "@/server/agencia/vertical";
import { salaVentaEnabled } from "@/server/agencia/sala-venta";
import { SalasClient } from "@/components/agencia/sala/salas-client";

export const dynamic = "force-dynamic";

/** Fork — salas de venta: "llámalos hoy", todas las salas y los planes de pago. */
export default async function SalasPage() {
  if (!salaVentaEnabled()) notFound();
  const session = await requireSession();
  if (!(await isRealtyOrg(session.organizationId))) notFound();
  if (!(await hasSaaSPlan(session.organizationId, "pro"))) redirect("/overview?upgrade=pro");
  return <SalasClient />;
}

import { notFound, redirect } from "next/navigation";
import { MenuClient } from "@/components/agencia/restaurante/menu-client";
import { requireSession } from "@/lib/auth/session";
import { hasSaaSPlan } from "@/server/agencia/entitlements";
import { isRestauranteOrg } from "@/server/agencia/vertical";

export const dynamic = "force-dynamic";

/**
 * Fork — vertical restaurante. Sin el vertical del negocio esta pantalla no
 * existe (404), igual que Propiedades sin el inmobiliario.
 */
export default async function Page() {
  const session = await requireSession();
  if (!(await isRestauranteOrg(session.organizationId))) notFound();
  if (!(await hasSaaSPlan(session.organizationId, "pro"))) redirect("/overview?upgrade=pro");
  return <MenuClient />;
}

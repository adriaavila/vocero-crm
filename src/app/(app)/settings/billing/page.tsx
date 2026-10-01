import { requireOwnerSession } from "@/lib/auth/session";
import { soldSaaSPlans } from "@/lib/saas-plans";
import { brand } from "@/lib/brand";
import { getOrganizationBilling } from "@/server/saas/billing";
import { BillingClient } from "@/components/settings/billing-client";

export const dynamic = "force-dynamic";

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ checkout?: string }>;
}) {
  const [session, params] = await Promise.all([requireOwnerSession(), searchParams]);
  return (
    <BillingClient
      billing={await getOrganizationBilling(session.organizationId)}
      soldPlans={soldSaaSPlans(process.env.SAAS_PLANS)}
      brandName={brand().Name}
      // El registro manda aquí cuando el checkout no abrió: la cuenta existe y
      // el pago no, así que la pantalla tiene que decirlo antes que nada.
      notice={params.checkout === "failed"
        ? "Tu espacio quedó creado, pero el pago no se completó. Elige un plan para terminar."
        : null}
    />
  );
}

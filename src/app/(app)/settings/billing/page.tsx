import { requireOwnerSession } from "@/lib/auth/session";
import { soldSaaSPlans } from "@/lib/saas-plans";
import { brand } from "@/lib/brand";
import { getOrganizationBilling } from "@/server/saas/billing";
import { getPlanState } from "@/server/agencia/plan-estado";
import { BillingClient } from "@/components/settings/billing-client";
import { hayCupones, MENSAJE_CANJE } from "@/server/agencia/cupones";

export const dynamic = "force-dynamic";

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ checkout?: string; billing?: string; cupon?: string }>;
}) {
  const [session, params] = await Promise.all([requireOwnerSession(), searchParams]);
  const [billing, plan] = await Promise.all([
    getOrganizationBilling(session.organizationId),
    getPlanState(session.organizationId),
  ]);
  return (
    <BillingClient
      billing={billing}
      plan={plan}
      portalReturn={params.billing === "portal"}
      cupones={hayCupones()}
      // El registro manda aquí con `?cupon=<motivo>` cuando el código no sirvió.
      cuponError={params.cupon
        ? params.cupon in MENSAJE_CANJE
          ? MENSAJE_CANJE[params.cupon as keyof typeof MENSAJE_CANJE]
          : "Tu espacio quedó creado, pero no pudimos revisar el código. Escríbelo de nuevo."
        : null}
      soldPlans={soldSaaSPlans(process.env.SAAS_PLANS)}
      brandName={brand().Name}
      trial={brand().id !== "rei"}
      // El registro manda aquí cuando el checkout no abrió: la cuenta existe y
      // el pago no, así que la pantalla tiene que decirlo antes que nada.
      notice={params.checkout === "failed"
        ? "Tu espacio quedó creado, pero el pago no se completó. Elige un plan para terminar."
        : null}
    />
  );
}

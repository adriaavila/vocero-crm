import { apiError, withOwner } from "@/lib/api";
import {
  appOrigin,
  getOrganizationBilling,
  getOrganizationForBilling,
  stripeForSaaS,
  tenantOrigin,
} from "@/server/saas/billing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withOwner<[Request]>(async (session, request: Request) => {
  const stripe = stripeForSaaS();
  const billing = await getOrganizationBilling(session.organizationId);
  if (!stripe || !billing.customerId) {
    return apiError(404, "billing_unavailable", "Todavía no hay un portal de facturación disponible.");
  }
  const organization = await getOrganizationForBilling(session.organizationId);
  if (!organization) return apiError(404, "organization_not_found", "Negocio no encontrado.");
  const returnOrigin = organization.slug ? tenantOrigin(organization.slug, request) : appOrigin(request);
  // Configuración propia del SaaS (`stripe-saas-setup.sh`): el portal por
  // defecto de la cuenta puede ser de otro producto. Sin la variable, el defecto.
  const configuration = process.env.ALLOK_SAAS_STRIPE_PORTAL_CONFIG_ID?.trim();
  const portal = await stripe.billingPortal.sessions.create({
    customer: billing.customerId,
    ...(configuration ? { configuration } : {}),
    // Vuelve a Facturación: ahí se ve el cambio (plan, cancelación, pago).
    return_url: `${returnOrigin}/settings/billing?billing=portal`,
  });
  return Response.json({ url: portal.url });
});

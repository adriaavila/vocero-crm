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
  const portal = await stripe.billingPortal.sessions.create({
    customer: billing.customerId,
    return_url: `${returnOrigin}/overview`,
  });
  return Response.json({ url: portal.url });
});

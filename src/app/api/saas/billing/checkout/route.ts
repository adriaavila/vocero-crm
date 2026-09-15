import { z } from "zod";
import { apiError, parseBody, withOwner } from "@/lib/api";
import {
  appOrigin,
  getOrganizationBilling,
  getOrganizationForBilling,
  priceIdForPlan,
  randomIntegrationSuffix,
  saveOrganizationBilling,
  stripeForSaaS,
  tenantOrigin,
  trialDaysForPlan,
  type SaaSPlan,
} from "@/server/saas/billing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ plan: z.enum(["basic", "pro"]) });

export const POST = withOwner<[Request]>(async (session, request: Request) => {
  const parsed = await parseBody(request, bodySchema);
  if (!parsed.ok) return parsed.response;
  const stripe = stripeForSaaS();
  const price = priceIdForPlan(parsed.data.plan);
  if (!stripe || !price) {
    return apiError(503, "billing_unconfigured", "El checkout SaaS todavía no está configurado.");
  }

  const organization = await getOrganizationForBilling(session.organizationId);
  if (!organization) return apiError(404, "organization_not_found", "Negocio no encontrado.");
  const current = await getOrganizationBilling(session.organizationId);
  if (current.status === "active" || current.status === "trialing") {
    return apiError(409, "billing_active", "Gestiona el cambio de plan desde tu portal de facturación.");
  }

  const customer = current.customerId
    ? current.customerId
    : (await stripe.customers.create({
        name: organization.name,
        metadata: { organizationId: session.organizationId },
      })).id;

  const origin = appOrigin(request);
  const dashboardOrigin = organization.slug ? tenantOrigin(organization.slug, request) : origin;
  const checkout = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer,
    line_items: [{ price, quantity: 1 }],
    success_url: `${dashboardOrigin}/overview?billing=success`,
    cancel_url: `${dashboardOrigin}/overview?billing=cancelled`,
    allow_promotion_codes: true,
    billing_address_collection: "auto",
    integration_identifier: `allok-saas-${parsed.data.plan}-${randomIntegrationSuffix()}`,
    metadata: {
      organizationId: session.organizationId,
      plan: parsed.data.plan,
    },
    subscription_data: {
      trial_period_days: trialDaysForPlan(parsed.data.plan),
      metadata: {
        organizationId: session.organizationId,
        plan: parsed.data.plan,
      },
    },
  });

  await saveOrganizationBilling(session.organizationId, {
    plan: parsed.data.plan as SaaSPlan,
    status: "incomplete",
    customerId: customer,
    priceId: price,
  });
  return Response.json({ url: checkout.url });
}, { allowSaaSAppHost: true });

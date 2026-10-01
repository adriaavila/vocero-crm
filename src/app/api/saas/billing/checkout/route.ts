import { apiError, parseBody, withOwner } from "@/lib/api";
import { soldSaaSPlans } from "@/lib/saas-plans";
import {
  appOrigin,
  checkoutBlocked,
  getOrganizationBilling,
  getOrganizationForBilling,
  hadPriorSubscription,
  pendingCheckoutBilling,
  priceIdForPlan,
  randomIntegrationSuffix,
  saveOrganizationBilling,
  selfServeTrialEnd,
  stripeForSaaS,
  tenantOrigin,
  trialDaysForPlan,
  type SaaSPlan,
} from "@/server/saas/billing";
import { checkoutBodySchema } from "@/server/saas/checkout";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withOwner<[Request]>(async (session, request: Request) => {
  const parsed = await parseBody(request, checkoutBodySchema);
  if (!parsed.ok) return parsed.response;
  if (!soldSaaSPlans(process.env.SAAS_PLANS).includes(parsed.data.plan)) {
    return apiError(422, "plan_not_offered", "Este plan no está disponible en este momento.");
  }
  const stripe = stripeForSaaS();
  const price = priceIdForPlan(parsed.data.plan);
  if (!stripe || !price) {
    return apiError(503, "billing_unconfigured", "El checkout SaaS todavía no está configurado.");
  }

  const organization = await getOrganizationForBilling(session.organizationId);
  if (!organization) return apiError(404, "organization_not_found", "Negocio no encontrado.");
  const current = await getOrganizationBilling(session.organizationId);
  // Durante la prueba de autoservicio (sin Stripe) sí puede pagar: es lo que
  // se le pide. `hadPriorSubscription` ya evita una segunda prueba en Stripe.
  if (checkoutBlocked(current)) {
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
  const trialEnd = selfServeTrialEnd(current);
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
      ...(trialEnd
        ? { trial_end: trialEnd }
        : { trial_period_days: trialDaysForPlan(parsed.data.plan, hadPriorSubscription(current)) }),
      metadata: {
        organizationId: session.organizationId,
        plan: parsed.data.plan,
      },
    },
  });

  await saveOrganizationBilling(
    session.organizationId,
    pendingCheckoutBilling(current, { plan: parsed.data.plan as SaaSPlan, customerId: customer, priceId: price }),
  );
  return Response.json({ url: checkout.url });
}, { allowSaaSAppHost: true });

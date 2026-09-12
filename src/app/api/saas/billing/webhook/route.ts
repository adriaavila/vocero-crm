import Stripe from "stripe";
import {
  getOrganizationBilling,
  hasRememberedBillingEvent,
  planForPriceId,
  rememberBillingEvent,
  saveOrganizationBilling,
  statusFromStripe,
  stripeForSaaS,
  webhookSecretForSaaS,
} from "@/server/saas/billing";
import { apiError } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function metadataOrganizationId(metadata: Stripe.Metadata | null | undefined): string | null {
  const value = metadata?.organizationId;
  return typeof value === "string" && value.length > 0 ? value : null;
}

async function organizationIdForEvent(stripe: Stripe, event: Stripe.Event): Promise<string | null> {
  const object = event.data.object as unknown as {
    metadata?: Stripe.Metadata;
    customer?: string | Stripe.Customer | Stripe.DeletedCustomer | null;
  };
  const direct = metadataOrganizationId(object.metadata);
  if (direct) return direct;

  const customerId = typeof object.customer === "string" ? object.customer : null;
  if (!customerId) return null;
  try {
    const customer = await stripe.customers.retrieve(customerId);
    return customer.deleted ? null : metadataOrganizationId(customer.metadata);
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const stripe = stripeForSaaS();
  const webhookSecret = webhookSecretForSaaS();
  const signature = request.headers.get("stripe-signature");
  if (!stripe || !webhookSecret || !signature) {
    return apiError(503, "billing_webhook_unconfigured", "El webhook SaaS no está configurado.");
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(await request.text(), signature, webhookSecret);
  } catch {
    return apiError(400, "invalid_signature", "Firma de Stripe inválida.");
  }

  if (await hasRememberedBillingEvent(event.id)) {
    return Response.json({ received: true, duplicate: true });
  }

  const organizationId = await organizationIdForEvent(stripe, event);
  if (!organizationId) return Response.json({ received: true, ignored: true });

  const supported = new Set([
    "checkout.session.completed",
    "customer.subscription.created",
    "customer.subscription.updated",
    "customer.subscription.deleted",
    "invoice.paid",
    "invoice.payment_failed",
  ]);
  if (!supported.has(event.type)) return Response.json({ received: true });

  if (event.type === "checkout.session.completed") {
    const checkout = event.data.object as Stripe.Checkout.Session;
    if (checkout.mode === "subscription") {
      const current = await getOrganizationBilling(organizationId);
      const customerId = typeof checkout.customer === "string"
        ? checkout.customer
        : current.customerId;
      const subscriptionId = typeof checkout.subscription === "string"
        ? checkout.subscription
        : checkout.subscription?.id ?? current.subscriptionId;
      await saveOrganizationBilling(organizationId, {
        plan: checkout.metadata?.plan === "basic" || checkout.metadata?.plan === "pro"
          ? checkout.metadata.plan
          : current.plan,
        customerId,
        subscriptionId,
        // El checkout confirma la sesión, no el estado vigente de la suscripción.
        // `customer.subscription.*` o `invoice.paid` habilita después.
        status: current.status,
        updatedAt: new Date(event.created * 1000).toISOString(),
      });
    }
  } else if (event.type.startsWith("customer.subscription.")) {
    const subscription = event.data.object as Stripe.Subscription;
    const priceId = subscription.items.data[0]?.price.id ?? null;
    const current = await getOrganizationBilling(organizationId);
    await saveOrganizationBilling(organizationId, {
      plan: planForPriceId(priceId) ?? current.plan,
      status: statusFromStripe(subscription.status),
      customerId: typeof subscription.customer === "string" ? subscription.customer : current.customerId,
      subscriptionId: subscription.id,
      priceId,
      currentPeriodEnd: subscription.items.data[0]?.current_period_end
        ? new Date(subscription.items.data[0].current_period_end * 1000).toISOString()
        : current.currentPeriodEnd,
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      updatedAt: new Date(event.created * 1000).toISOString(),
    });
  } else {
    const invoice = event.data.object as Stripe.Invoice;
    const invoiceData = invoice as unknown as {
      customer?: string | Stripe.Customer | Stripe.DeletedCustomer | null;
      subscription?: string | Stripe.Subscription | null;
    };
    const current = await getOrganizationBilling(organizationId);
    const invoiceSubscriptionId = typeof invoiceData.subscription === "string"
      ? invoiceData.subscription
      : null;
    // Un cobro atrasado de una suscripción vieja no debe pausar una nueva que
    // ya está vigente tras un cambio de plan o recuperación.
    if (current.subscriptionId && invoiceSubscriptionId && current.subscriptionId !== invoiceSubscriptionId) {
      return Response.json({ received: true, ignored: true, stale_subscription: true });
    }
    await saveOrganizationBilling(organizationId, {
      status: current.status === "canceled"
        ? "canceled"
        : event.type === "invoice.paid" ? "active" : "past_due",
      customerId: typeof invoiceData.customer === "string" ? invoiceData.customer : current.customerId,
      subscriptionId: typeof invoiceData.subscription === "string" ? invoiceData.subscription : current.subscriptionId,
      updatedAt: new Date(event.created * 1000).toISOString(),
    });
  }

  // Se registra después de persistir el estado: si la BD falla, Stripe debe
  // poder reintentar el evento en vez de encontrar un idempotency key huérfano.
  if (!(await rememberBillingEvent(event.id, event.type, organizationId))) {
    return Response.json({ received: true, duplicate: true });
  }

  return Response.json({ received: true });
}

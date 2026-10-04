import Stripe from "stripe";
import {
  billingFromMetadata,
  getOrganizationForBillingLocked,
  hasRememberedBillingEvent,
  invoiceSubscriptionId,
  isCurrentOrFirstSubscriptionEvent,
  planForPriceId,
  rememberBillingEvent,
  saveOrganizationBilling,
  statusFromStripe,
  subscriptionEndsAtPeriodEnd,
  stripeForSaaS,
  webhookSecretForSaaS,
} from "@/server/saas/billing";
import { apiError } from "@/lib/api";
import { isSaaSPlan } from "@/lib/saas-plans";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isLiveStatus(status: string): boolean {
  return status === "active" || status === "trialing" || status === "past_due";
}

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

  // Lee-decide-escribe en una transacción con la fila del negocio bloqueada:
  // dos eventos del mismo cliente (created y completed suelen llegar juntos)
  // no se pisan.
  const ignored = await getDb().transaction(async (tx): Promise<Record<string, boolean> | null> => {
    const locked = await getOrganizationForBillingLocked(organizationId, tx);
    if (!locked) return { ignored: true };
    const current = billingFromMetadata(locked.metadata);
    const updatedAt = new Date(event.created * 1000).toISOString();

    if (event.type === "checkout.session.completed") {
      const checkout = event.data.object as Stripe.Checkout.Session;
      if (checkout.mode === "subscription") {
        const customerId = typeof checkout.customer === "string"
          ? checkout.customer
          : current.customerId;
        const subscriptionId = typeof checkout.subscription === "string"
          ? checkout.subscription
          : checkout.subscription?.id ?? current.subscriptionId;
        // Sin `status`: el checkout confirma la sesión, no el estado vigente de
        // la suscripción, y puede llegar después de `customer.subscription.*`
        // (que ya dejó `active`). `customer.subscription.*` o `invoice.paid`
        // lo habilitan.
        await saveOrganizationBilling(organizationId, {
          plan: isSaaSPlan(checkout.metadata?.plan) ? checkout.metadata.plan : current.plan,
          customerId,
          subscriptionId,
          updatedAt,
        }, tx);
      }
    } else if (event.type.startsWith("customer.subscription.")) {
      const subscription = event.data.object as Stripe.Subscription;
      const priceId = subscription.items.data[0]?.price.id ?? null;
      if (current.detachedSubscriptionId === subscription.id) {
        return { ignored: true, stale_subscription: true };
      }
      if (!isCurrentOrFirstSubscriptionEvent(current, subscription.id, event.type)) {
        if (event.type === "customer.subscription.created" && current.subscriptionId && isLiveStatus(current.status)) {
          // Un segundo cobro vivo para el mismo cliente: no se silencia, alguien
          // tiene que cancelarlo o reembolsarlo en Stripe.
          console.error("[saas-billing] second live subscription for the same customer", {
            organizationId,
            customerId: typeof subscription.customer === "string" ? subscription.customer : null,
            currentSubscriptionId: current.subscriptionId,
            newSubscriptionId: subscription.id,
            newStatus: subscription.status,
          });
        }
        return { ignored: true, stale_subscription: true };
      }
      await saveOrganizationBilling(organizationId, {
        plan: planForPriceId(priceId) ?? current.plan,
        status: statusFromStripe(subscription.status),
        customerId: typeof subscription.customer === "string" ? subscription.customer : current.customerId,
        subscriptionId: subscription.id,
        priceId,
        currentPeriodEnd: subscription.items.data[0]?.current_period_end
          ? new Date(subscription.items.data[0].current_period_end * 1000).toISOString()
          : current.currentPeriodEnd,
        cancelAtPeriodEnd: subscriptionEndsAtPeriodEnd(subscription, event.created * 1000),
        updatedAt,
      }, tx);
    } else {
      const invoice = event.data.object as Stripe.Invoice;
      const invoiceData = invoice as unknown as {
        customer?: string | Stripe.Customer | Stripe.DeletedCustomer | null;
      };
      const invoiceSubscription = invoiceSubscriptionId(invoice);
      // Una suscripción que una concesión manual desenganchó no vuelve por un
      // cobro tardío.
      if (invoiceSubscription && current.detachedSubscriptionId === invoiceSubscription) {
        return { ignored: true, stale_subscription: true };
      }
      // Un cobro atrasado de una suscripción vieja no debe pausar una nueva que
      // ya está vigente tras un cambio de plan o recuperación.
      if (current.subscriptionId && invoiceSubscription && current.subscriptionId !== invoiceSubscription) {
        return { ignored: true, stale_subscription: true };
      }
      await saveOrganizationBilling(organizationId, {
        status: current.status === "canceled"
          ? "canceled"
          : event.type === "invoice.paid" ? "active" : "past_due",
        customerId: typeof invoiceData.customer === "string" ? invoiceData.customer : current.customerId,
        subscriptionId: invoiceSubscription ?? current.subscriptionId,
        updatedAt,
      }, tx);
    }
    return null;
  });
  if (ignored) return Response.json({ received: true, ...ignored });

  // Se registra después de persistir el estado: si la BD falla, Stripe debe
  // poder reintentar el evento en vez de encontrar un idempotency key huérfano.
  if (!(await rememberBillingEvent(event.id, event.type, organizationId))) {
    return Response.json({ received: true, duplicate: true });
  }

  return Response.json({ received: true });
}

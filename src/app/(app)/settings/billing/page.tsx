import { requireOwnerSession } from "@/lib/auth/session";
import { getOrganizationBilling } from "@/server/saas/billing";
import { BillingClient } from "@/components/settings/billing-client";

export const dynamic = "force-dynamic";

export default async function BillingPage() {
  const session = await requireOwnerSession();
  return <BillingClient billing={await getOrganizationBilling(session.organizationId)} />;
}

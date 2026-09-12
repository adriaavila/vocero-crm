import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { isAllokSaaSMode } from "@/lib/tenant-host";

export type AutomationBillingStatus =
  | "incomplete"
  | "trialing"
  | "active"
  | "past_due"
  | "unpaid"
  | "canceled"
  | "inactive";

type Metadata = Record<string, unknown>;

export function hasPaidSaaSPlanFromMetadata(
  raw: string | null | undefined,
  plan: "pro",
  saasMode = isAllokSaaSMode(),
): boolean {
  if (!saasMode) return true;
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw) as {
      allok?: { billing?: { plan?: string; status?: string } };
    };
    const billing = parsed.allok?.billing;
    return billing?.plan === plan && (billing.status === "active" || billing.status === "trialing");
  } catch {
    return false;
  }
}

export function automationAccessFromMetadata(
  raw: string | null | undefined,
  saasMode = isAllokSaaSMode(),
): { allowed: boolean; status: AutomationBillingStatus } {
  if (!saasMode) return { allowed: true, status: "active" };
  if (!raw) return { allowed: false, status: "inactive" };

  let metadata: Metadata;
  try {
    const parsed: unknown = JSON.parse(raw);
    metadata = parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Metadata)
      : {};
  } catch {
    return { allowed: false, status: "inactive" };
  }

  const allok = metadata.allok;
  const billing =
    allok && typeof allok === "object" && !Array.isArray(allok)
      ? (allok as Metadata).billing
      : null;
  const status =
    billing && typeof billing === "object" && !Array.isArray(billing)
      ? (billing as Metadata).status
      : null;
  const normalized: AutomationBillingStatus =
    status === "trialing" || status === "active" || status === "past_due" ||
    status === "unpaid" || status === "canceled" || status === "incomplete"
      ? status
      : "inactive";

  return {
    allowed: normalized === "active" || normalized === "trialing",
    status: normalized,
  };
}

export async function canAutomate(organizationId: string): Promise<boolean> {
  if (!isAllokSaaSMode()) return true;
  const rows = await getDb()
    .select({ metadata: schema.organization.metadata })
    .from(schema.organization)
    .where(eq(schema.organization.id, organizationId))
    .limit(1);
  return automationAccessFromMetadata(rows[0]?.metadata).allowed;
}

export async function hasSaaSPlan(
  organizationId: string,
  plan: "pro",
): Promise<boolean> {
  if (!isAllokSaaSMode()) return true;
  const rows = await getDb()
    .select({ metadata: schema.organization.metadata })
    .from(schema.organization)
    .where(eq(schema.organization.id, organizationId))
    .limit(1);
  return hasPaidSaaSPlanFromMetadata(rows[0]?.metadata, plan);
}

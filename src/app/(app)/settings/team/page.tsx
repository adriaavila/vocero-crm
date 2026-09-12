import { TeamClient } from "@/components/settings/team-client";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { hasSaaSPlan } from "@/server/agencia/entitlements";

export const dynamic = "force-dynamic";

export default async function TeamSettingsPage() {
  const session = await requireSession();
  if (!(await hasSaaSPlan(session.organizationId, "pro"))) redirect("/overview?upgrade=pro");
  return <TeamClient />;
}

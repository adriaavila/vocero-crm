import { headers } from "next/headers";
import { getAuth } from "@/lib/auth";
import { requireSession } from "@/lib/auth/session";
import { OverviewDashboard } from "@/components/overview/overview-dashboard";
import { getOverview } from "@/server/overview";
import { getReadiness } from "@/server/readiness";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  const session = await requireSession();
  const [overview, readiness, authSession] = await Promise.all([
    getOverview(session.organizationId),
    session.role === "owner" ? getReadiness(session.organizationId) : null,
    getAuth().api.getSession({ headers: await headers() }),
  ]);
  return <OverviewDashboard data={overview} readiness={readiness} userName={authSession?.user.name ?? ""} owner={session.role === "owner"} />;
}

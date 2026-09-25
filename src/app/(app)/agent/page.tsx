import { AgentClient } from "@/components/agent/agent-client";
import { requireOwnerSession } from "@/lib/auth/session";
import { isAllokSaaSMode } from "@/lib/tenant-host";

export const dynamic = "force-dynamic";

export default async function AgentPage() {
  await requireOwnerSession();
  return <AgentClient saasMode={isAllokSaaSMode()} />;
}

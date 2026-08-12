import { AgentClient } from "@/components/agent/agent-client";
import { requireOwnerSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function AgentPage() {
  await requireOwnerSession();
  return <AgentClient />;
}

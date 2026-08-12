import { PipelineClient } from "@/components/pipeline/pipeline-client";
import { requireSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function PipelinePage() {
  const session = await requireSession();
  return <PipelineClient canManage={session.role === "owner"} />;
}

import { LabClient } from "@/components/lab/lab-client";
import { requireOwnerSession } from "@/lib/auth/session";
import { getSetupProgress } from "@/server/agencia/setup-progress";

export const dynamic = "force-dynamic";

export default async function LabPage() {
  const session = await requireOwnerSession();
  // El avance de la puesta en marcha llega ya resuelto: sin saltos al cargar.
  const progress = await getSetupProgress(session.organizationId).catch(() => null);
  return <LabClient initialProgress={progress} />;
}

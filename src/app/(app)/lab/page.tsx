import { LabClient } from "@/components/lab/lab-client";
import { requireOwnerSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function LabPage() {
  await requireOwnerSession();
  return <LabClient />;
}

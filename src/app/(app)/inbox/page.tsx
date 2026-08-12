import { InboxClient } from "@/components/inbox/inbox-client";
import { requireSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function InboxPage() {
  const session = await requireSession();
  return <InboxClient owner={session.role === "owner"} />;
}

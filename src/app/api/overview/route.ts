import { withAuth } from "@/lib/api";
import { getOverview } from "@/server/overview";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (session) =>
  Response.json(await getOverview(session.organizationId))
);

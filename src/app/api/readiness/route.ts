import { withOwner } from "@/lib/api";
import { getReadiness } from "@/server/readiness";

export const dynamic = "force-dynamic";

export const GET = withOwner(async (session) =>
  Response.json(await getReadiness(session.organizationId))
);

import { z } from "zod";
import { parseBody, withOwner } from "@/lib/api";
import { getSeguimiento, saveSeguimiento } from "@/server/agencia/seguimiento";

export const dynamic = "force-dynamic";

/** Fork — seguimiento al cliente que dejó de contestar. `hours: 0` lo apaga. */
export const GET = withOwner(async (session) => {
  return Response.json({ hours: (await getSeguimiento(session.organizationId)) ?? 0 });
});

const bodySchema = z.object({ hours: z.number().int().min(0).max(23) });

export const PUT = withOwner(async (session, request: Request) => {
  const body = await parseBody(request, bodySchema);
  if (!body.ok) return body.response;
  const hours = await saveSeguimiento(session.organizationId, body.data.hours);
  return Response.json({ hours: hours ?? 0 });
});

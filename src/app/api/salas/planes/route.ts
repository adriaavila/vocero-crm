import { parseBody } from "@/lib/api";
import {
  PlanInputSchema,
  crearPlan,
  listarPlanes,
  serializarPlan,
} from "@/server/agencia/sala-venta";
import { salaErrorResponse, withSala } from "@/server/agencia/sala-venta-http";

export const dynamic = "force-dynamic";

export const GET = withSala(async (session) => {
  const planes = await listarPlanes(session.organizationId);
  return Response.json({ planes: planes.map(serializarPlan) });
});

export const POST = withSala(async (session, req: Request) => {
  const parsed = await parseBody(req, PlanInputSchema);
  if (!parsed.ok) return parsed.response;
  try {
    const plan = await crearPlan(session.organizationId, parsed.data);
    return Response.json({ plan: serializarPlan(plan) }, { status: 201 });
  } catch (err) {
    return salaErrorResponse(err);
  }
});

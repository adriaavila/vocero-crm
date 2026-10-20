import { apiError } from "@/lib/api";
import { archivarPlan } from "@/server/agencia/sala-venta";
import { withSala } from "@/server/agencia/sala-venta-http";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** Archiva: las salas que ya lo usan siguen mostrándolo igual. */
export const DELETE = withSala(async (session, _req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const ok = await archivarPlan(session.organizationId, id);
  if (!ok) return apiError(404, "not_found", "Plan no encontrado");
  return new Response(null, { status: 204 });
});

import { z } from "zod";
import { mockGuard } from "@/lib/dev-guard";
import { barrerRecuperar } from "@/server/agencia/recuperar";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ now: z.string().datetime().optional() }).catch({});

/** Mock/E2E: corre una pasada de «recuperar clientes» sin esperar al worker. 404 en producción. */
export async function POST(request: Request) {
  const guard = mockGuard();
  if (guard) return guard;
  const body = bodySchema.parse(await request.json().catch(() => ({})));
  const now = body.now ? new Date(body.now) : new Date();
  return Response.json({ enviados: await barrerRecuperar(now, { forzar: true }) });
}

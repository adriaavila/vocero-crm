import { mockGuard } from "@/lib/dev-guard";
import { runTrialLifecycleOnce } from "@/server/agencia/trial-correos";

export const dynamic = "force-dynamic";

/** Mock/E2E: corre una pasada de los correos de la prueba, sin esperar al temporizador. 404 en producción. */
export async function POST() {
  const guard = mockGuard();
  if (guard) return guard;
  return Response.json(await runTrialLifecycleOnce());
}

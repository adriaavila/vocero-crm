import { mockGuard } from "@/lib/dev-guard";
import { getWaMockState } from "@/server/dev/wa-mock-state";

export const dynamic = "force-dynamic";

/**
 * Fork — Embedded Signup en la app: cada `POST {phone}/smb_app_data` que
 * recibió el mock. Meta no tiene un GET para releer esto, así que el
 * self-test verifica por aquí que el sync de coexistencia se pidió (mismo
 * patrón que `/api/dev/wa-mock/capi-events` y `/outbox`).
 */
export async function GET() {
  const guard = mockGuard();
  if (guard) return guard;
  return Response.json({ smbAppDataRequests: getWaMockState().smbAppDataRequests });
}

export async function DELETE() {
  const guard = mockGuard();
  if (guard) return guard;
  getWaMockState().smbAppDataRequests.length = 0;
  return Response.json({ cleared: true });
}

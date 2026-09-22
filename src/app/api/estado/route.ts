import { withAuth } from "@/lib/api";
import { getSystemState } from "@/server/agencia/estado";

export const dynamic = "force-dynamic";

/**
 * Capa de agencia: el estado de la operación (activo · atendiendo · atención ·
 * pausado). Lo pide la barra lateral cada vez que llega un evento, para que el
 * punto de `all ● k` y el icono de la pestaña digan la verdad sin recargar.
 */
export const GET = withAuth(async (session) =>
  Response.json(await getSystemState(session.organizationId, session.role === "owner"))
);

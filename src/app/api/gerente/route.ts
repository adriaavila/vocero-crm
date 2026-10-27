import { apiError, withAuth } from "@/lib/api";
import { codigoParaConectar, desconectarGerente, estadoGerente } from "@/server/agencia/gerente";

export const dynamic = "force-dynamic";

/**
 * Fork — «Tu gerente de ventas por WhatsApp» (tarjeta de Inicio).
 * GET: ¿está disponible?, ¿ya conecté mi WhatsApp?, el código vigente.
 * POST: un código nuevo para mandar al número de Rei (30 min).
 * DELETE: desconectar mi WhatsApp.
 * Siempre de la persona de la sesión, en el negocio de la sesión.
 */
export const GET = withAuth(async (session) => Response.json(await estadoGerente(session.organizationId, session.userId)));

export const POST = withAuth(async (session) => {
  const actual = await estadoGerente(session.organizationId, session.userId);
  if (!actual.disponible) return apiError(404, "not_found", "No disponible");
  return Response.json(await codigoParaConectar(session.organizationId, session.userId));
});

export const DELETE = withAuth(async (session) => {
  await desconectarGerente(session.organizationId, session.userId);
  return Response.json(await estadoGerente(session.organizationId, session.userId));
});

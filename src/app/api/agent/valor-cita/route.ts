import { z } from "zod";
import { parseBody, withOwner } from "@/lib/api";
import { guardarValorCita } from "@/server/agencia/lo-que-trajo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Hasta 100 millones en la moneda del negocio: una cita no vale más que eso.
const Body = z.object({ valorCitaCents: z.number().int().min(1).max(10_000_000_000).nullable() }).strict();

/**
 * Fork (agencia): cuánto le deja una cita al negocio, para que Inicio y el
 * resumen del día digan en plata lo que agendó el agente. `null` lo borra.
 */
export const PUT = withOwner<[Request]>(async (session, req: Request) => {
  const body = await parseBody(req, Body);
  if (!body.ok) return body.response;
  await guardarValorCita(session.organizationId, body.data.valorCitaCents);
  return Response.json({ valorCitaCents: body.data.valorCitaCents });
});

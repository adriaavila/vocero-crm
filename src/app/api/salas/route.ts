import { parseBody } from "@/lib/api";
import {
  SalaInputSchema,
  getSalaDeContacto,
  guardarSala,
  listarSalas,
  serializarSala,
} from "@/server/agencia/sala-venta";
import { baseUrlDe, salaErrorResponse, withSala } from "@/server/agencia/sala-venta-http";

export const dynamic = "force-dynamic";

/** `?contactId=` → la sala de ese contacto (o `null`); sin él, todas con "llámalos hoy". */
export const GET = withSala(async (session, req: Request) => {
  const base = baseUrlDe(req);
  const contactId = new URL(req.url).searchParams.get("contactId");
  if (contactId) {
    const sala = await getSalaDeContacto(session.organizationId, contactId);
    return Response.json({ sala: sala ? serializarSala(sala, base) : null });
  }
  const { salas, llamarHoy } = await listarSalas(session.organizationId);
  return Response.json({
    salas: salas.map((s) => ({ ...serializarSala(s, base), nombre: s.nombre })),
    llamarHoy: llamarHoy.map((s) => ({ ...serializarSala(s, base), nombre: s.nombre })),
  });
});

/** Crea o actualiza la sala de un contacto. El link no cambia al actualizar. */
export const POST = withSala(async (session, req: Request) => {
  const parsed = await parseBody(req, SalaInputSchema);
  if (!parsed.ok) return parsed.response;
  try {
    const sala = await guardarSala(session.organizationId, session.userId, parsed.data);
    return Response.json({ sala: serializarSala(sala, baseUrlDe(req)) });
  } catch (err) {
    return salaErrorResponse(err);
  }
});


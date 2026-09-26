import { withOwner } from "@/lib/api";
import { withAtribucionFlag } from "@/server/attribution/flag";
import { listConversionActivity } from "@/server/attribution/conversions";

export const dynamic = "force-dynamic";

/**
 * 016 — Actividad reciente de conversiones (solo lectura).
 *
 * Responde la única pregunta que importa cuando uno duda de esto: "¿le está
 * llegando algo a Meta y, si no, por qué?". Sin acciones: este endpoint jamás
 * escribe.
 *
 * `withOwner`, no `withAuth`: misma superficie que la configuración del
 * dataset — quien puede ver el dataset y el token puede ver a quién se le
 * reportó. `withAtribucionFlag` por FUERA: la bandera apagada gana sobre
 * cualquier rol (ver la nota en settings/capi/route.ts).
 */
export const GET = withAtribucionFlag(
  withOwner(async (session, req: Request) => {
    const raw = new URL(req.url).searchParams.get("limit");
    const parsed = raw ? Number.parseInt(raw, 10) : NaN;
    // Un límite fuera de rango se recorta, no falla: es un panel, no un
    // contrato de paginación.
    const limit = Number.isFinite(parsed) ? parsed : undefined;
    const events = await listConversionActivity(session.organizationId, limit);
    return Response.json({ events });
  })
);

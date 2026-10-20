import { z } from "zod";
import { apiError, parseBody } from "@/lib/api";
import { enviarSalaPorWhatsapp } from "@/server/agencia/sala-whatsapp";
import { baseUrlDe, salaErrorResponse, withSala } from "@/server/agencia/sala-venta-http";
import { SendError } from "@/server/inbox/send";

export const dynamic = "force-dynamic";

const Input = z.object({ contactId: z.string().min(1) });

/**
 * El asesor le manda su sala por WhatsApp: saludo, una tarjeta con botones
 * por casa y el link. Solo dentro de las 24 h desde su último mensaje.
 */
export const POST = withSala(async (session, req: Request) => {
  const parsed = await parseBody(req, Input);
  if (!parsed.ok) return parsed.response;
  try {
    const res = await enviarSalaPorWhatsapp({
      organizationId: session.organizationId,
      contactId: parsed.data.contactId,
      userId: session.userId,
      baseUrl: baseUrlDe(req),
    });
    return Response.json(res);
  } catch (err) {
    if (err instanceof SendError) {
      const mensaje =
        err.code === "window_closed"
          ? "Pasaron más de 24 horas desde su último mensaje: para escribirle hace falta una plantilla aprobada por Meta. Mándale el link con «Copiar mensaje» desde tu teléfono."
          : err.message;
      return apiError(err.code === "meta_unavailable" ? 503 : 409, err.code, mensaje);
    }
    return salaErrorResponse(err);
  }
});

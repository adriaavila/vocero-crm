import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/lib/db";
import { apiError, parseBody } from "@/lib/api";
import { requireBotKey, resolveInstanceOrg } from "@/server/bot/auth";
import { publish } from "@/server/events/bus";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ text: z.string().trim().min(1).max(8000) });

const TRANSCRIBABLE_TYPES = new Set(["audio", "document", "image"]);

/**
 * Nea sin estado (dispatch v2) — transcripción de UN entrante de
 * audio/documento/imagen, para que viaje en `history` sin que Nea tenga que
 * volver a bajar y transcribir el adjunto en cada despacho.
 *
 * `POST /api/bot/messages/{id}/transcript` `{text}`.
 *
 * Primera escritura gana: Nea transcribe una vez y no vuelve a pisar lo ya
 * guardado (por ejemplo si dos despachos en vuelo transcriben el mismo
 * adjunto). 404 si el mensaje no existe, no es de esta organización, no es
 * entrante o no es un tipo transcribible — el bot no distingue "no existe" de
 * "no aplica": ninguno de los dos es su problema.
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const denied = requireBotKey(req);
  if (denied) return denied;

  const organizationId = await resolveInstanceOrg(req);
  if (!organizationId) {
    return apiError(409, "no_org", "La instancia aún no tiene organización");
  }

  const { id } = await ctx.params;
  const body = await parseBody(req, bodySchema);
  if (!body.ok) return body.response;

  const db = getDb();
  const rows = await db
    .select({
      id: schema.message.id,
      conversationId: schema.message.conversationId,
      direction: schema.message.direction,
      type: schema.message.type,
      status: schema.message.status,
      transcript: schema.message.transcript,
    })
    .from(schema.message)
    .where(and(eq(schema.message.organizationId, organizationId), eq(schema.message.id, id)))
    .limit(1);
  const message = rows[0];
  if (
    !message ||
    message.direction !== "in" ||
    !TRANSCRIBABLE_TYPES.has(message.type)
  ) {
    return apiError(404, "not_found", "Mensaje no encontrado");
  }

  // Ya transcrito: se devuelve tal cual, sin pisar lo que ya se guardó.
  if (message.transcript) {
    return Response.json({ transcript: message.transcript });
  }

  // `IS NULL` en el WHERE cierra la carrera: si dos despachos transcriben el
  // mismo adjunto casi a la vez, solo el primer UPDATE afecta la fila.
  const updated = await db
    .update(schema.message)
    .set({ transcript: body.data.text })
    .where(and(eq(schema.message.id, id), isNull(schema.message.transcript)))
    .returning({ transcript: schema.message.transcript });
  if (updated[0]) {
    // Item 10: el mismo evento que usa el resto del hilo para actualizar un
    // mensaje ya pintado (`message.status`, con `status` sin cambiar) — así
    // el inbox abierto pinta la transcripción sin esperar un refetch.
    publish(organizationId, {
      type: "message.status",
      data: {
        conversationId: message.conversationId,
        messageId: message.id,
        status: message.status,
        transcript: updated[0].transcript,
      },
    });
    return Response.json({ transcript: updated[0].transcript });
  }

  // Perdió la carrera contra otro escritor entre el SELECT y el UPDATE: se
  // devuelve lo que de verdad ganó, no lo que este intento quería guardar.
  const winner = await db
    .select({ transcript: schema.message.transcript })
    .from(schema.message)
    .where(eq(schema.message.id, id))
    .limit(1);
  return Response.json({ transcript: winner[0]?.transcript ?? body.data.text });
}

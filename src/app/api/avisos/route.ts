import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { endpointPermitido } from "@/lib/avisos";
import { isMockEnabled } from "@/lib/env";
import { newId } from "@/lib/db/ids";
import {
  borrarSuscripcion,
  guardarSuscripcion,
  tieneSuscripcion,
  vapidPublicKey,
} from "@/server/agencia/avisos";

export const dynamic = "force-dynamic";

/**
 * Fork — avisos al celular. GET: la llave pública para suscribirse y si ESTE
 * navegador ya está suscrito (`?endpoint=`). POST: «avísame en este
 * teléfono». DELETE: «ya no».
 */
export const GET = withAuth(async (session, req: Request) => {
  const endpoint = new URL(req.url).searchParams.get("endpoint");
  return Response.json({
    publicKey: vapidPublicKey(),
    subscribed: endpoint ? await tieneSuscripcion(session.organizationId, endpoint) : false,
  });
});

const subscriptionSchema = z.object({
  endpoint: z.string().url().max(2000),
  keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
});

export const POST = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, subscriptionSchema);
  if (!body.ok) return body.response;
  if (!endpointPermitido(body.data.endpoint, { local: isMockEnabled() })) {
    return apiError(422, "endpoint_not_allowed", "Ese navegador no tiene un servicio de avisos conocido.");
  }
  await guardarSuscripcion({
    id: newId("pushSubscription"),
    organizationId: session.organizationId,
    userId: session.userId,
    subscription: body.data,
    userAgent: req.headers.get("user-agent"),
  });
  return Response.json({ ok: true });
});

const deleteSchema = z.object({ endpoint: z.string().url().max(2000) });

export const DELETE = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, deleteSchema);
  if (!body.ok) return body.response;
  await borrarSuscripcion(session.organizationId, body.data.endpoint);
  return Response.json({ ok: true });
});

import { and, eq } from "drizzle-orm";
import { apiError, parseBody } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { PedidoNuevo } from "@/server/agencia/restaurante/esquemas";
import { withRestaurante } from "@/server/agencia/restaurante/guard";
import { armarPedido, listarPedidos, pedidosDeConversacion } from "@/server/agencia/restaurante/pedidos";

export const dynamic = "force-dynamic";

/** El tablero, o los pedidos de una conversación con `?conversationId=`. */
export const GET = withRestaurante(async (session, req: Request) => {
  const conversationId = new URL(req.url).searchParams.get("conversationId");
  const pedidos = conversationId
    ? await pedidosDeConversacion(session.organizationId, conversationId)
    : await listarPedidos(session.organizationId);
  return Response.json({ pedidos });
});

/** Una persona arma el pedido a mano desde la conversación. */
export const POST = withRestaurante(async (session, req: Request) => {
  const parsed = await parseBody(req, PedidoNuevo);
  if (!parsed.ok) return parsed.response;
  const conv = await getDb()
    .select({
      id: schema.conversation.id,
      contactId: schema.conversation.contactId,
      isTest: schema.conversation.isTest,
    })
    .from(schema.conversation)
    .where(
      and(
        scoped(schema.conversation.organizationId, session.organizationId),
        eq(schema.conversation.id, parsed.data.conversationId)
      )
    )
    .limit(1);
  if (!conv[0]) return apiError(404, "not_found", "Conversación no encontrada");
  const { pedido, rechazos } = await armarPedido({
    organizationId: session.organizationId,
    conversationId: conv[0].id,
    contactId: conv[0].contactId,
    isTest: conv[0].isTest,
    lineas: parsed.data.lineas,
    mode: parsed.data.mode,
    address: parsed.data.address,
    createdBy: "persona",
    userId: session.userId,
  });
  if (!pedido) return Response.json({ error: { code: "sin_lineas", message: "Nada de eso está en el menú" }, rechazos }, { status: 422 });
  return Response.json({ pedido, rechazos }, { status: 201 });
});

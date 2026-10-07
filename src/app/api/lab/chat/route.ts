import { z } from "zod";
import { apiError, parseBody, withOwner } from "@/lib/api";
import { CHAT_PRUEBA_TEXT_MAX, getChatPrueba, sendChatPrueba } from "@/server/agencia/chat-prueba";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ text: z.string().trim().min(1).max(CHAT_PRUEBA_TEXT_MAX) }).strict();

/** Fork (agencia): «Escríbele como cliente» en Probar. Sandbox: nada sale a WhatsApp. */
export const GET = withOwner(async (session) => Response.json(await getChatPrueba(session.organizationId)));

export const POST = withOwner<[Request]>(async (session, req: Request) => {
  const body = await parseBody(req, Body);
  if (!body.ok) return body.response;
  const result = await sendChatPrueba(session.organizationId, body.data.text);
  if (!result.ok) return apiError(result.status, result.code, result.message);
  return Response.json(result.chat);
});

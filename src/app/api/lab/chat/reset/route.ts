import { withOwner } from "@/lib/api";
import { resetChatPrueba } from "@/server/agencia/chat-prueba";

export const dynamic = "force-dynamic";

/** Fork (agencia): empieza otra conversación de prueba con el agente. */
export const POST = withOwner(async (session) => Response.json(await resetChatPrueba(session.organizationId)));

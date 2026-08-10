import { z } from "zod";
import { apiError, parseBody } from "@/lib/api";
import { requireBotKey, resolveInstanceOrg } from "@/server/bot/auth";
import { mergeFicha } from "@/server/bot/gateway";

export const dynamic = "force-dynamic";

const fichaSchema = z.record(z.unknown()).refine(
  (value) => Buffer.byteLength(JSON.stringify(value), "utf8") <= 16 * 1024,
  "La ficha excede 16 KB"
);
const bodySchema = z.object({
  conversationId: z.string().min(1),
  ficha: fichaSchema,
});

export async function PUT(req: Request) {
  const denied = requireBotKey(req);
  if (denied) return denied;
  const organizationId = await resolveInstanceOrg();
  if (!organizationId) return apiError(409, "no_org", "La instancia aún no tiene organización");
  const body = await parseBody(req, bodySchema);
  if (!body.ok) return body.response;
  const result = await mergeFicha({
    organizationId,
    conversationId: body.data.conversationId,
    patch: body.data.ficha,
  });
  return result
    ? Response.json(result)
    : apiError(404, "not_found", "Conversación no encontrada");
}

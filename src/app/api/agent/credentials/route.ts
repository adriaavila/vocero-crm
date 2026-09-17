import { z } from "zod";
import { apiError, parseBody, withOwner } from "@/lib/api";
import { AI_DEFAULT_MODELS, type AiProvider } from "@/lib/ai/config";
import { probeAiProvider } from "@/lib/ai";
import {
  deleteAiCredential,
  listAiCredentialStatuses,
  saveAiCredential,
} from "@/server/ai/credentials";

export const dynamic = "force-dynamic";

const providerSchema = z.enum(["openai", "openrouter"]);
const putSchema = z.object({
  provider: providerSchema,
  apiKey: z.string().trim().min(1).max(500),
  model: z.string().trim().max(200).optional(),
});

export const GET = withOwner(async (session) => {
  return Response.json({
    credentials: await listAiCredentialStatuses(session.organizationId),
  });
});

/** Prueba la clave primero; una falla nunca reemplaza una credencial válida. */
export const PUT = withOwner(async (session, req: Request) => {
  const body = await parseBody(req, putSchema);
  if (!body.ok) return body.response;

  const provider = body.data.provider as AiProvider;
  const model = body.data.model?.trim() || AI_DEFAULT_MODELS[provider];
  const probe = await probeAiProvider(provider, { token: body.data.apiKey, model });
  if (!probe.ok) {
    return apiError(
      422,
      "ai_credential_invalid",
      "No se pudo validar la clave o el modelo. Revisa ambos datos e inténtalo de nuevo.",
    );
  }

  await saveAiCredential({
    organizationId: session.organizationId,
    provider,
    apiKey: body.data.apiKey,
    model,
  });
  return Response.json({
    ok: true,
    credentials: await listAiCredentialStatuses(session.organizationId),
  });
});

export const DELETE = withOwner(async (session, req: Request) => {
  const provider = providerSchema.safeParse(new URL(req.url).searchParams.get("provider"));
  if (!provider.success) {
    return apiError(422, "invalid_provider", "Proveedor de IA inválido");
  }
  await deleteAiCredential(session.organizationId, provider.data);
  return Response.json({
    ok: true,
    credentials: await listAiCredentialStatuses(session.organizationId),
  });
});

import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import type { AiUsage } from "@/lib/ai";

/**
 * Una fila de `usage_event` por turno del agente que llegó al proveedor.
 * Un fallo al medir jamás tumba el turno: se pierde la fila, no la respuesta.
 */
export async function recordAiUsage(input: {
  organizationId: string;
  conversationId: string | null;
  kind: "agent";
  ok: boolean;
  usage: AiUsage;
}): Promise<void> {
  if (input.usage.calls === 0) return;
  try {
    await getDb().insert(schema.usageEvent).values({
      id: newId("usageEvent"),
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      kind: input.kind,
      provider: input.usage.provider,
      model: input.usage.model,
      calls: input.usage.calls,
      promptTokens: input.usage.promptTokens,
      completionTokens: input.usage.completionTokens,
      ok: input.ok,
    });
  } catch (err) {
    console.error(`[uso] no se pudo registrar el consumo: ${err instanceof Error ? err.message : String(err)}`);
  }
}

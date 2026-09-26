import { asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { renderKb } from "@/server/ai/prompts";
// Capa de agencia: los frenos del piloto viajan con el perfil (server/agencia/).
import { perfilDeAgencia } from "@/server/agencia/bot-perfil";

type AgentProfile = typeof schema.agentProfile.$inferSelect;
type KbEntry = typeof schema.kbEntry.$inferSelect;

/**
 * Payload del perfil del agente para un cerebro externo.
 *
 * `enabled` NO viaja: ese flag gobierna la IA in-process de Vocero; el bot
 * externo se pausa por conversación (`aiEnabled` del contexto y los handoffs),
 * no por este endpoint. `resources` nace vacío para que el shape del consumidor
 * no cambie cuando existan recursos alternativos reales.
 */
export function serializeBotProfile(profile: AgentProfile, kb: KbEntry[]) {
  return {
    profile: {
      name: profile.name,
      tone: profile.tone ?? null,
      instructions: profile.instructions ?? null,
      escalationRules: profile.escalationRules ?? null,
      greeting: profile.greeting ?? null,
    },
    kb: renderKb(kb),
    resources: [] as { label: string; url: string }[],
  };
}

export type BotProfile = ReturnType<typeof serializeBotProfile> & {
  profile: ReturnType<typeof serializeBotProfile>["profile"] &
    Awaited<ReturnType<typeof perfilDeAgencia>>;
};

/**
 * Constructor ÚNICO del perfil para un cerebro externo: `GET /api/bot/profile`
 * y el payload de despacho a Nea (dispatch v2, campo `profile`) usan
 * EXACTAMENTE esta función para no poder divergir. `null` cuando la instancia
 * no tiene perfil de agente (condición esperada: el bot cae a su brief local).
 */
export async function buildBotProfile(organizationId: string): Promise<BotProfile | null> {
  const db = getDb();
  const profiles = await db
    .select()
    .from(schema.agentProfile)
    .where(eq(schema.agentProfile.organizationId, organizationId))
    .limit(1);
  const profile = profiles[0];
  if (!profile) return null;

  const kb = await db
    .select()
    .from(schema.kbEntry)
    .where(eq(schema.kbEntry.organizationId, organizationId))
    .orderBy(asc(schema.kbEntry.createdAt));

  const base = serializeBotProfile(profile, kb);
  const agencia = await perfilDeAgencia(organizationId);
  return { ...base, profile: { ...base.profile, ...agencia } };
}

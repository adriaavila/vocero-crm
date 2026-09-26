import { eq } from "drizzle-orm";
import { AI_DEFAULT_MODELS, type AiProvider, type AiProviderSettings } from "@/lib/ai/config";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { isNeaBrain } from "@/lib/env";

export type AiRuntimeConfig = {
  providers: Partial<Record<AiProvider, AiProviderSettings>>;
};

export type AiCredentialStatus = {
  provider: AiProvider;
  configured: boolean;
  source: "organization" | "platform" | "none";
  model: string;
  last4: string | null;
  lastValidatedAt: string | null;
  /**
   * `invalid`: Nea reportó `auth_failed`/`no_credits` con esta clave (dispatch
   * v2, step 6) — sigue respondiendo con la de allok mientras el dueño no la
   * reemplace. `null` cuando la fuente no es `organization` (no aplica).
   */
  lastValidationStatus: "valid" | "invalid" | null;
};

export type AiCredentialStatuses = Record<AiProvider, AiCredentialStatus>;

/** Claves propias primero; el entorno de plataforma queda como fallback. */
export async function getAiRuntimeConfig(organizationId: string): Promise<AiRuntimeConfig> {
  const providers: Partial<Record<AiProvider, AiProviderSettings>> = {};

  if (process.env.OPENAI_API_KEY?.trim()) {
    providers.openai = {
      token: process.env.OPENAI_API_KEY,
      model: process.env.OPENAI_MODEL?.trim() || AI_DEFAULT_MODELS.openai,
      judgeModel: process.env.OPENAI_JUDGE_MODEL?.trim() || undefined,
    };
  }
  if (process.env.OPENROUTER_API_TOKEN?.trim()) {
    providers.openrouter = {
      token: process.env.OPENROUTER_API_TOKEN,
      model: process.env.OPENROUTER_MODEL?.trim() || AI_DEFAULT_MODELS.openrouter,
      judgeModel: process.env.OPENROUTER_JUDGE_MODEL?.trim() || undefined,
    };
  }

  const rows = await getDb()
    .select()
    .from(schema.aiCredentials)
    .where(scoped(schema.aiCredentials.organizationId, organizationId));
  for (const row of rows) {
    try {
      providers[row.provider] = {
        token: decryptSecret({
          cipher: row.keyCipher,
          iv: row.keyIv,
          tag: row.keyTag,
        }),
        model: row.model,
      };
    } catch {
      // Una clave de cifrado rota no debe tumbar la instancia ni exponer datos.
      console.error(`[ai] no se pudo descifrar la credencial de ${row.provider}`);
    }
  }
  return { providers };
}

export function hasConfiguredAiProvider(config: AiRuntimeConfig): boolean {
  return Object.values(config.providers).some(
    (provider) => Boolean(provider?.token.trim() && provider.model.trim()),
  );
}

export async function isAiConfiguredForOrganization(organizationId: string): Promise<boolean> {
  return hasConfiguredAiProvider(await getAiRuntimeConfig(organizationId));
}

/**
 * true si algún cerebro puede responder por esta organización: Nea (que no
 * necesita una clave de IA propia por-org, la firma con `BOT_API_KEY`) o Rei
 * con un proveedor de IA configurado (propio o de plataforma). Los gates que
 * antes preguntaban "¿tiene IA configurada?" para decidir si el agente puede
 * encenderse deben preguntar esto en su lugar, o una instancia con Nea nunca
 * pasaría el gate.
 */
export async function isAgentAvailableForOrganization(organizationId: string): Promise<boolean> {
  return isNeaBrain() || (await isAiConfiguredForOrganization(organizationId));
}

export async function listAiCredentialStatuses(organizationId: string): Promise<AiCredentialStatuses> {
  const rows = await getDb()
    .select()
    .from(schema.aiCredentials)
    .where(scoped(schema.aiCredentials.organizationId, organizationId));
  const byProvider = new Map(rows.map((row) => [row.provider, row]));
  const platform = {
    openai: Boolean(process.env.OPENAI_API_KEY?.trim()),
    openrouter: Boolean(process.env.OPENROUTER_API_TOKEN?.trim()),
  } satisfies Record<AiProvider, boolean>;
  const platformModels = {
    openai: process.env.OPENAI_MODEL?.trim() || AI_DEFAULT_MODELS.openai,
    openrouter: process.env.OPENROUTER_MODEL?.trim() || AI_DEFAULT_MODELS.openrouter,
  } satisfies Record<AiProvider, string>;

  return {
    openai: statusFor("openai", byProvider.get("openai"), platform.openai, platformModels.openai),
    openrouter: statusFor("openrouter", byProvider.get("openrouter"), platform.openrouter, platformModels.openrouter),
  };
}

export async function saveAiCredential(input: {
  organizationId: string;
  provider: AiProvider;
  apiKey: string;
  model: string;
}): Promise<void> {
  const key = input.apiKey.trim();
  const model = input.model.trim();
  const encrypted = encryptSecret(key);
  await getDb()
    .insert(schema.aiCredentials)
    .values({
      id: newId("aiCredential"),
      organizationId: input.organizationId,
      provider: input.provider,
      model,
      keyCipher: encrypted.cipher,
      keyIv: encrypted.iv,
      keyTag: encrypted.tag,
      keyLast4: key.slice(-4),
      lastValidatedAt: new Date(),
      lastValidationStatus: "valid",
    })
    .onConflictDoUpdate({
      target: [schema.aiCredentials.organizationId, schema.aiCredentials.provider],
      set: {
        model,
        keyCipher: encrypted.cipher,
        keyIv: encrypted.iv,
        keyTag: encrypted.tag,
        keyLast4: key.slice(-4),
        lastValidatedAt: new Date(),
        lastValidationStatus: "valid",
        updatedAt: new Date(),
      },
    });
}

export async function deleteAiCredential(
  organizationId: string,
  provider: AiProvider,
): Promise<void> {
  await getDb()
    .delete(schema.aiCredentials)
    .where(
      scoped(
        schema.aiCredentials.organizationId,
        organizationId,
        eq(schema.aiCredentials.provider, provider),
      ),
    );
}

function statusFor(
  provider: AiProvider,
  row: typeof schema.aiCredentials.$inferSelect | undefined,
  platformConfigured: boolean,
  platformModel: string,
): AiCredentialStatus {
  return {
    provider,
    configured: Boolean(row) || platformConfigured,
    source: row ? "organization" : platformConfigured ? "platform" : "none",
    model: row?.model ?? platformModel,
    last4: row?.keyLast4 ?? null,
    lastValidatedAt: row?.lastValidatedAt?.toISOString() ?? null,
    lastValidationStatus: row?.lastValidationStatus ?? null,
  };
}

/**
 * La clave de IA PROPIA de la organización para Nea (dispatch v2, contrato
 * `llm`). Nunca lee la clave de plataforma — Nea tiene la suya, y mandarle esa
 * sería filtrar un secreto que no le corresponde a un servicio externo.
 *
 * Prefiere el proveedor de `agent_profile.ai_provider`; si la organización
 * solo guardó clave para el OTRO proveedor, usa esa (mejor una respuesta con
 * el proveedor no preferido que ninguna clave propia). `updatedAt` viaja para
 * que quien marque la clave inválida (step 6) solo lo haga si nadie la
 * resguardó entre el despacho y la respuesta de Nea.
 */
export async function getNeaLlmCredential(organizationId: string): Promise<{
  provider: AiProvider;
  model: string;
  apiKey: string;
  /** El IV (texto, cambia en CADA guardado) — lo que step 6 compara para
   *  invalidar, en vez de `updatedAt` (ver el comentario en
   *  `markAiCredentialInvalidIfUnchanged`). */
  keyIv: string;
} | null> {
  const db = getDb();
  const [profileRows, credRows] = await Promise.all([
    db
      .select({ aiProvider: schema.agentProfile.aiProvider })
      .from(schema.agentProfile)
      .where(scoped(schema.agentProfile.organizationId, organizationId))
      .limit(1),
    db
      .select()
      .from(schema.aiCredentials)
      .where(scoped(schema.aiCredentials.organizationId, organizationId)),
  ]);

  // Una clave marcada `invalid` (Nea ya reportó auth_failed/no_credits con
  // ella) NO se vuelve a mandar: eso solo repetiría el mismo rechazo turno
  // tras turno antes de que Nea caiga a su propia clave de plataforma.
  // Guardar o probar una clave nueva siempre la revalida (`saveAiCredential`
  // escribe `valid` en los dos caminos, insert y conflicto).
  const validRows = credRows.filter((r) => r.lastValidationStatus !== "invalid");
  if (validRows.length === 0) return null;

  const preferred = profileRows[0]?.aiProvider;
  const row = validRows.find((r) => r.provider === preferred) ?? validRows[0]!;
  try {
    const apiKey = decryptSecret({ cipher: row.keyCipher, iv: row.keyIv, tag: row.keyTag });
    return { provider: row.provider, model: row.model, apiKey, keyIv: row.keyIv };
  } catch {
    // Clave de cifrado rota: ni Nea ni Rei pueden usar esta credencial.
    console.error(`[ai] no se pudo descifrar la credencial de ${row.provider} (Nea)`);
    return null;
  }
}

/**
 * Marca `last_validation_status='invalid'` SOLO si `key_iv` sigue siendo el
 * mismo que cuando se armó el despacho — si el dueño re-guardó la clave
 * mientras Nea procesaba ese turno, `encryptSecret` generó un IV nuevo
 * (aleatorio en CADA guardado) y este UPDATE no afecta ninguna fila: un turno
 * viejo no debe invalidar una clave nueva.
 *
 * Se compara `key_iv` (texto) y NO `updated_at`: la fila nace por INSERT con
 * el `now()` del lado de Postgres (microsegundos) pero se lee de vuelta como
 * `Date` de JS (milisegundos) — la comparación por igualdad perdía la parte
 * fraccionaria y el UPDATE nunca encontraba la fila después del PRIMER
 * guardado. `key_iv` es texto: la comparación es exacta siempre.
 */
export async function markAiCredentialInvalidIfUnchanged(
  organizationId: string,
  provider: AiProvider,
  expectedKeyIv: string,
): Promise<void> {
  await getDb()
    .update(schema.aiCredentials)
    .set({ lastValidationStatus: "invalid" })
    .where(
      scoped(
        schema.aiCredentials.organizationId,
        organizationId,
        eq(schema.aiCredentials.provider, provider),
        eq(schema.aiCredentials.keyIv, expectedKeyIv),
      ),
    );
}

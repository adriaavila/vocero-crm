import type { z } from "zod";
import { getEnv, isAiConfigured, type Env } from "@/lib/env";

/**
 * Adaptador LLM OpenAI-compatible — ÚNICA frontera con el proveedor de IA
 * (Constitución II). Dos proveedores posibles (OpenAI y OpenRouter, ambos
 * hablan el mismo formato chat/completions): el llamador elige preferido con
 * `opts.provider`, y si ese no está configurado o falla tras sus reintentos,
 * se cae automáticamente al otro proveedor configurado. Regla operativa: la
 * salida del modelo es impredecible; todo consumo pasa por extracción
 * robusta + Zod + reintentos, y un hipo del proveedor jamás propaga
 * excepción (resultado `error` tipado).
 */

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ChatJsonResult<T> =
  | { ok: true; data: T; raw: string }
  | { ok: false; error: "not_configured" | "provider_error" | "invalid_output"; detail: string };

export type AiProvider = "openai" | "openrouter";

const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 500;

type ResolvedProvider = { name: AiProvider; baseUrl: string; token: string; model: string };

function resolveProvider(
  name: AiProvider,
  judge: boolean,
  modelOverride: string | undefined,
  env: Env
): ResolvedProvider | null {
  if (name === "openrouter") {
    const token = env.OPENROUTER_API_TOKEN;
    const model = modelOverride ?? env.OPENROUTER_MODEL;
    if (!token || !model?.trim()) return null;
    return { name, baseUrl: env.OPENROUTER_BASE_URL, token, model };
  }
  const token = env.OPENAI_API_KEY;
  const model = modelOverride ?? (judge ? (env.OPENAI_JUDGE_MODEL ?? env.OPENAI_MODEL) : env.OPENAI_MODEL);
  if (!token || !model?.trim()) return null;
  return { name, baseUrl: env.OPENAI_BASE_URL, token, model };
}

/** Preferido primero; el otro queda como fallback si el preferido no sirve. */
function providerOrder(preferred: AiProvider): AiProvider[] {
  return preferred === "openrouter" ? ["openrouter", "openai"] : ["openai", "openrouter"];
}

export async function chatJson<T>(
  schema: z.ZodType<T>,
  messages: ChatMessage[],
  opts?: { model?: string; judge?: boolean; timeoutMs?: number; provider?: AiProvider }
): Promise<ChatJsonResult<T>> {
  if (!isAiConfigured()) {
    return {
      ok: false,
      error: "not_configured",
      detail: "Sin proveedor de IA configurado (OPENAI_API_KEY u OPENROUTER_API_TOKEN)",
    };
  }
  const env = getEnv();
  const order = providerOrder(opts?.provider ?? "openai");
  const candidates = order
    .map((name) => resolveProvider(name, opts?.judge ?? false, opts?.model, env))
    .filter((p): p is ResolvedProvider => p !== null);
  if (candidates.length === 0) {
    return {
      ok: false,
      error: "not_configured",
      detail: "Ningún proveedor tiene token + modelo configurados",
    };
  }

  let lastResult: ChatJsonResult<T> | null = null;
  for (const provider of candidates) {
    const result = await attemptProvider(schema, messages, provider, opts?.timeoutMs);
    if (result.ok) return result;
    lastResult = result;
  }
  return lastResult!;
}

async function attemptProvider<T>(
  schema: z.ZodType<T>,
  messages: ChatMessage[],
  provider: ResolvedProvider,
  timeoutMs: number | undefined
): Promise<ChatJsonResult<T>> {
  let lastDetail = "";
  let lastIssues = "";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const attemptMessages: ChatMessage[] =
      attempt === 1
        ? messages
        : [
            ...messages,
            {
              role: "system",
              content: `STRICT: tu respuesta anterior no fue válida${lastIssues ? ` (${lastIssues})` : ""}. Responde ÚNICAMENTE el objeto JSON, sin explicaciones ni markdown, con cada valor como string plano.`,
            },
          ];
    try {
      const raw = await callProvider(
        provider.baseUrl,
        provider.token,
        provider.model,
        attemptMessages,
        timeoutMs
      );
      const extracted = extractJson(raw);
      if (extracted === null) {
        lastIssues = "sin JSON extraíble";
        lastDetail = `[${provider.name}] ${lastIssues} (raw=${truncate(raw)})`;
        continue;
      }
      const parsed = schema.safeParse(extracted);
      if (!parsed.success) {
        lastIssues = parsed.error.issues
          .map((i) => i.path.join(".") + " " + i.message)
          .join("; ");
        lastDetail = `[${provider.name}] no cumple el esquema: ${lastIssues} (raw=${truncate(raw)})`;
        continue;
      }
      return { ok: true, data: parsed.data, raw };
    } catch (err) {
      lastDetail = `[${provider.name}] ${err instanceof Error ? err.message : String(err)}`;
      if (attempt < MAX_ATTEMPTS) {
        await sleep(RETRY_DELAY_MS * attempt);
      }
    }
  }

  return {
    ok: false,
    error: lastDetail.includes("esquema") || lastDetail.includes("JSON")
      ? "invalid_output"
      : "provider_error",
    detail: lastDetail,
  };
}

async function callProvider(
  baseUrl: string,
  token: string,
  model: string,
  messages: ChatMessage[],
  timeoutMs = 60_000
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        // El token jamás se loguea; solo viaja en este header.
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model, messages }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`proveedor respondió ${res.status}: ${truncate(text)}`);
    }
    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = json.choices?.[0]?.message?.content;
    if (typeof content !== "string" || content.length === 0) {
      throw new Error("respuesta del proveedor sin contenido");
    }
    return content;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Extracción robusta de JSON de una respuesta de modelo:
 * 1) bloque ```json ... ``` (o ``` ... ```), 2) el texto completo,
 * 3) del primer `{` al último `}`.
 */
export function extractJson(raw: string): unknown | null {
  const candidates: string[] = [];
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) candidates.push(fence[1].trim());
  candidates.push(raw.trim());
  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first !== -1 && last > first) {
    candidates.push(raw.slice(first, last + 1));
  }
  for (const c of candidates) {
    try {
      return JSON.parse(c);
    } catch {
      // siguiente candidato
    }
  }
  return null;
}

function truncate(s: string, n = 300): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

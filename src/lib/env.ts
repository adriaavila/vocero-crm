import { z } from "zod";

/**
 * Validación central del entorno.
 *
 * Lazy + memoizada: se evalúa en el primer uso en runtime, nunca al importar.
 * Durante `next build` no hay secretos (la imagen se construye sin ellos), así
 * que en esa fase se aceptan placeholders — los valores reales llegan al boot.
 */

const envSchema = z.object({
  APP_BASE_URL: z.string().url(),
  DATABASE_URL: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(16),
  ENCRYPTION_KEY: z
    .string()
    .refine((v) => Buffer.from(v, "base64").length === 32, {
      message:
        "ENCRYPTION_KEY debe ser 32 bytes en base64 (genera con: openssl rand -base64 32)",
    }),
  META_WEBHOOK_VERIFY_TOKEN: z.string().min(8),
  META_APP_SECRET: z.string().optional(),
  META_GRAPH_API_VERSION: z.string().default("v25.0"),
  META_GRAPH_BASE_URL: z.string().url().default("https://graph.facebook.com"),
  // Proveedor de IA principal (agente, parseo de perfil y juez del Laboratorio).
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_BASE_URL: z.string().url().default("https://api.openai.com"),
  OPENAI_MODEL: z.string().optional(),
  // Modelo distinto para el juez (p. ej. uno más barato); si se omite usa OPENAI_MODEL.
  OPENAI_JUDGE_MODEL: z.string().optional(),
  // Proveedor alterno (modelo gratuito): fallback automático si el preferido
  // no está configurado o falla, y elegible por org en Configuración → Agente.
  OPENROUTER_API_TOKEN: z.string().optional(),
  OPENROUTER_BASE_URL: z.string().url().default("https://openrouter.ai/api"),
  OPENROUTER_MODEL: z.string().optional(),
  OPENROUTER_JUDGE_MODEL: z.string().optional(),
  // 014/017: canales encendidos, separados por coma. WhatsApp siempre esta on.
  // Ej.: CHANNELS=whatsapp,instagram,messenger. Sin ella, la instancia es solo
  // WhatsApp y las superficies de los demas canales responden 404.
  CHANNELS: z.string().optional(),
  // 015: motor de agenda. Apagado por defecto — sin el, toda la superficie de
  // agenda responde 404 y la UI no la menciona. Ej.: AGENDA=on
  AGENDA: z.string().optional(),
  // 016: atribucion de anuncios y reporte a la Conversions API de Meta.
  // Apagada por defecto: sin ella no se captura de que anuncio vino una
  // conversacion, no se le reporta nada a Meta y la superficie da 404.
  // Ej.: ATRIBUCION=on
  ATRIBUCION: z.string().optional(),
  // 015: bases de los conectores. Solo se sobreescriben para apuntar a los
  // mocks en el self-test; en producción se usan las reales.
  ZOOM_BASE_URL: z.string().url().default("https://api.zoom.us/v2"),
  ZOOM_OAUTH_BASE_URL: z.string().url().default("https://zoom.us"),
  GOOGLE_CAL_BASE_URL: z
    .string()
    .url()
    .default("https://www.googleapis.com/calendar/v3"),
  GOOGLE_OAUTH_BASE_URL: z.string().url().default("https://oauth2.googleapis.com"),
  ALLOW_SIGNUP: z.string().optional(),
  AGENT_COALESCE_MS: z.coerce.number().int().min(0).default(6000),
  WA_MOCK_ENABLED: z.string().optional(),
  // API key de un cerebro externo que conduzca la conversación por /api/bot/*.
  // Sin ella, toda esa superficie responde 401. También firma el despacho a
  // Nea (HMAC-SHA256 del body exacto) cuando NEA_DISPATCH_URL está presente.
  BOT_API_KEY: z.string().optional(),
  // URL del servicio de Nea al que el CRM despacha cada turno entrante
  // (`POST ${NEA_DISPATCH_URL}`). Sin ella, Rei (el agente interno) contesta
  // si tiene proveedor de IA configurado.
  NEA_DISPATCH_URL: z.string().url().optional(),
  // Secreto compartido con allok para `POST /api/provision`: allok entrega ahí
  // las credenciales de un número recién conectado. Sin ella, la ruta responde 401.
  PROVISION_API_KEY: z.string().min(16).optional(),
  WHATSAPP_SMOKE_TEST_TO: z.string().trim().optional(),
  WAHA_API_URL: z.string().url().optional(),
  WAHA_API_KEY: z.string().min(16).optional(),
  WAHA_SESSION: z.string().min(1).default("vocero-test"),
  GOOGLE_CALENDAR_ID: z.string().optional(),
  GOOGLE_SERVICE_ACCOUNT_JSON_B64: z.string().optional(),
  GOOGLE_OAUTH_CLIENT_ID: z.string().optional(),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().optional(),
  CALENDAR_TIME_ZONE: z.string().min(1).default("UTC"),
  CALENDAR_UTC_OFFSET_MINUTES: z.coerce
    .number()
    .int()
    .min(-14 * 60)
    .max(14 * 60)
    .default(0),
  // 008: volumen local de adjuntos (constitución II: sin S3/R2).
  MEDIA_DIR: z.string().default("./.dev-media"),
  NODE_ENV: z.string().default("development"),
});

export type Env = z.infer<typeof envSchema>;

const BUILD_PLACEHOLDERS: Record<string, string> = {
  APP_BASE_URL: "http://localhost:3000",
  DATABASE_URL: "postgresql://build:build@localhost:5432/build",
  BETTER_AUTH_SECRET: "placeholder-build-secret",
  ENCRYPTION_KEY: Buffer.alloc(32).toString("base64"),
  META_WEBHOOK_VERIFY_TOKEN: "placeholder-verify-token",
};

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;
  const isBuild = process.env.NEXT_PHASE === "phase-production-build";
  // Los strings vacíos cuentan como ausentes: los compose/paneles suelen
  // inyectar VAR="" para opcionales y eso debe activar los defaults.
  const source = isBuild
    ? { ...BUILD_PLACEHOLDERS, ...stripEmpty(process.env) }
    : stripEmpty(process.env);
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const missing = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("\n  ");
    throw new Error(
      `Variables de entorno inválidas o faltantes:\n  ${missing}\n` +
        "Revisa .env.example para la guía de cada variable."
    );
  }
  cached = parsed.data;
  return cached;
}

/** Solo para tests: limpia el cache para que el próximo getEnv() re-lea process.env. */
export function resetEnvCacheForTests(): void {
  cached = null;
}

function stripEmpty(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (v !== undefined && v !== "") out[k] = v;
  }
  return out;
}

/** true si el entorno de pruebas interno (mocks) está habilitado y NO es producción. */
export function isMockEnabled(): boolean {
  return (
    process.env.WA_MOCK_ENABLED === "true" &&
    process.env.NODE_ENV !== "production"
  );
}

/** true si hay al menos un proveedor de IA configurado (OpenAI u OpenRouter). */
export function isAiConfigured(): boolean {
  const hasToken = (v: string | undefined) => typeof v === "string" && v.trim().length > 0;
  return hasToken(process.env.OPENAI_API_KEY) || hasToken(process.env.OPENROUTER_API_TOKEN);
}

/**
 * true si esta instancia tiene un cerebro externo conectado por `/api/bot/*`
 * — Nea u otro bot propio, sin importar si además está enganchado por
 * despacho (`isNeaBrain()`). Idéntico al comportamiento de siempre: un
 * `BOT_API_KEY` configurado significa "hay un bot al mando", y Rei se hace a
 * un lado. Cambiar ESTO por algo condicionado a `NEA_DISPATCH_URL` fue el
 * bug que hacía que una instancia dedicada con `BOT_API_KEY` + una clave de
 * IA propia terminara con Rei respondiendo A LA VEZ que su bot externo.
 */
export function isExternalBrainConfigured(): boolean {
  return (process.env.BOT_API_KEY?.trim().length ?? 0) >= 16;
}

/**
 * true si Nea (el cerebro externo) está lista para recibir despachos:
 * necesita a dónde mandar el turno (`NEA_DISPATCH_URL`) y con qué firmarlo
 * (`BOT_API_KEY`, ≥16 caracteres — lo mismo que `isExternalBrainConfigured`,
 * más específico). Sin `NEA_DISPATCH_URL`, un `BOT_API_KEY` configurado sigue
 * significando "hay un cerebro externo LEGADO al mando" (`isExternalBrainConfigured`),
 * no "no hay ningún cerebro": el trato con ese bot no cambia con este PR.
 */
export function isNeaBrain(): boolean {
  const hasDispatchUrl = (process.env.NEA_DISPATCH_URL?.trim().length ?? 0) > 0;
  return hasDispatchUrl && isExternalBrainConfigured();
}

/** El bot externo (Nea o legado) tiene prioridad para no responder dos veces al mismo mensaje. */
export function shouldRunInternalAgent(): boolean {
  return isAiConfigured() && !isExternalBrainConfigured();
}

/** true si responde el agente interno o un cerebro externo autenticado. */
export function isAgentConfigured(): boolean {
  return isAiConfigured() || isExternalBrainConfigured();
}

export function isWahaConfigured(): boolean {
  return Boolean(process.env.WAHA_API_URL?.trim() && process.env.WAHA_API_KEY?.trim());
}

export function calendarTimeZone(): string {
  return process.env.CALENDAR_TIME_ZONE?.trim() || "UTC";
}

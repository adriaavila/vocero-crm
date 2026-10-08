import { and, eq, inArray, isNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { getEnv } from "@/lib/env";
import type { AiProvider, AiProviderSettings } from "@/lib/ai";
import { textoParaAgente } from "@/lib/medios-agente";
import { publish } from "@/server/events/bus";
import { inboundSinceLastReply } from "@/server/agencia/decisions";
import { ensureAssetAvailable, readMediaFile } from "@/server/whatsapp/media";

/**
 * Fork — el agente (Rei) oye las notas de voz y ve las imágenes.
 *
 * Antes de cada turno, los adjuntos que el cliente mandó desde la última
 * respuesta se transcriben (audio) o se describen (imagen) UNA vez, y eso se
 * guarda en `message.transcript` (primera escritura gana, igual que con Nea),
 * así la bandeja lo muestra y los turnos siguientes no lo vuelven a pagar.
 *
 * Con OpenRouter se usa un modelo que oye y ve (Gemini Flash-Lite: GLM no
 * oye); con solo OpenAI, whisper para el audio y gpt-4o-mini para la imagen.
 * Cualquier fallo (descarga, proveedor, archivo grande) deja el mensaje sin
 * transcripción y el agente recibe el aviso de `textoParaAgente`: el turno
 * nunca se cae por un adjunto.
 */

export const MODELO_OPENROUTER = "google/gemini-2.5-flash-lite";
const MODELO_OPENAI_VISTA = "gpt-4o-mini";
const MODELO_OPENAI_OIDO = "whisper-1";

/** Más que esto no se manda al proveedor (base64 crece un tercio). */
const LIMITE_BYTES: Record<"audio" | "image", number> = {
  audio: 10 * 1024 * 1024,
  image: 5 * 1024 * 1024,
};
/** Adjuntos por turno: una ráfaga de 10 fotos no dispara 10 llamadas. */
const POR_TURNO = 3;
const ESPERA_MS = 25_000;
const MAX_CARACTERES = 2000;

const PIDE_OIDO =
  "Transcribe literalmente esta nota de voz de un cliente. Responde solo con la transcripción, sin comillas ni comentarios. Si no se entiende nada, responde exactamente: (inaudible)";
const PIDE_VISTA =
  "Un cliente mandó esta imagen a un negocio por WhatsApp. Describe en una o dos frases, en español, lo que se ve. Si tiene texto legible (precios, montos, fechas, nombres, un comprobante de pago), cópialo tal cual. Responde solo con la descripción.";

type Mensaje = typeof schema.message.$inferSelect;
type Medio = typeof schema.mediaAsset.$inferSelect;
type Proveedores = Partial<Record<AiProvider, AiProviderSettings>>;

const FORMATOS_AUDIO: Record<string, string> = {
  "audio/ogg": "ogg",
  "audio/opus": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/mp4": "m4a",
  "audio/m4a": "m4a",
  "audio/x-m4a": "m4a",
  "audio/aac": "aac",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/webm": "webm",
  "audio/flac": "flac",
};

function formatoAudio(mime: string | null): string {
  return FORMATOS_AUDIO[(mime ?? "").split(";")[0]!.trim().toLowerCase()] ?? "ogg";
}

async function conEspera<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ESPERA_MS);
  try {
    return await fn(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

function limpiar(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim().replace(/^["«]|["»]$/g, "").trim();
  if (!t || /^\(?inaudible\)?\.?$/i.test(t)) return null;
  return t.slice(0, MAX_CARACTERES);
}

async function porChat(
  baseUrl: string,
  token: string,
  model: string,
  parte: Record<string, unknown>,
  pide: string
): Promise<string | null> {
  return conEspera(async (signal) => {
    const res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: [{ type: "text", text: pide }, parte] }],
      }),
      signal,
    });
    if (!res.ok) throw new Error(`proveedor respondió ${res.status}`);
    const json = (await res.json()) as { choices?: { message?: { content?: unknown } }[] };
    return limpiar(json.choices?.[0]?.message?.content);
  });
}

async function whisper(
  baseUrl: string,
  token: string,
  data: Buffer,
  mime: string | null
): Promise<string | null> {
  return conEspera(async (signal) => {
    const form = new FormData();
    const formato = formatoAudio(mime);
    form.append("file", new Blob([new Uint8Array(data)], { type: mime ?? "audio/ogg" }), `nota.${formato}`);
    form.append("model", MODELO_OPENAI_OIDO);
    const res = await fetch(`${baseUrl}/v1/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
      signal,
    });
    if (!res.ok) throw new Error(`proveedor respondió ${res.status}`);
    const json = (await res.json()) as { text?: unknown };
    return limpiar(json.text);
  });
}

/** Transcribe o describe un adjunto. null si no se pudo (nunca lanza). */
export async function oirOVer(
  organizationId: string,
  medio: Medio,
  proveedores: Proveedores
): Promise<string | null> {
  if (medio.kind !== "audio" && medio.kind !== "image") return null;
  const kind = medio.kind;
  try {
    const listo = await ensureAssetAvailable(organizationId, medio.id);
    if (!listo || listo.fetchStatus !== "available") return null;
    const data = await readMediaFile(organizationId, medio.id);
    if (data.length === 0 || data.length > LIMITE_BYTES[kind]) return null;
    const mime = listo.mimeType ?? (kind === "audio" ? "audio/ogg" : "image/jpeg");
    const b64 = data.toString("base64");
    const env = getEnv();

    const openrouter = proveedores.openrouter?.token ?? env.OPENROUTER_API_TOKEN;
    if (openrouter) {
      try {
        const parte =
          kind === "audio"
            ? { type: "input_audio", input_audio: { data: b64, format: formatoAudio(mime) } }
            : { type: "image_url", image_url: { url: `data:${mime};base64,${b64}` } };
        const r = await porChat(env.OPENROUTER_BASE_URL, openrouter, MODELO_OPENROUTER, parte, kind === "audio" ? PIDE_OIDO : PIDE_VISTA);
        if (r) return r;
      } catch (err) {
        console.warn(`[oir-y-ver] OpenRouter no pudo con ${kind}: ${err instanceof Error ? err.message : err}`);
      }
    }
    const openai = proveedores.openai?.token ?? env.OPENAI_API_KEY;
    if (openai) {
      return kind === "audio"
        ? await whisper(env.OPENAI_BASE_URL, openai, data, mime)
        : await porChat(
            env.OPENAI_BASE_URL,
            openai,
            MODELO_OPENAI_VISTA,
            { type: "image_url", image_url: { url: `data:${mime};base64,${b64}` } },
            PIDE_VISTA
          );
    }
    return null;
  } catch (err) {
    console.warn(`[oir-y-ver] no se pudo con el ${kind} ${medio.id}: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

export type LineaHistorial = { id: string; direction: "in" | "out"; content: string };

/**
 * El historial tal como lo debe ver el agente: cada mensaje como una línea,
 * los adjuntos nuevos del cliente ya oídos o vistos.
 */
export async function historialParaAgente(input: {
  organizationId: string;
  conversationId: string;
  history: Mensaje[];
  proveedores: Proveedores;
}): Promise<LineaHistorial[]> {
  const { organizationId, conversationId, history, proveedores } = input;
  const ids = [...new Set(history.map((m) => m.mediaAssetId).filter((v): v is string => !!v))];
  const medios = new Map<string, Medio>();
  if (ids.length) {
    const rows = await getDb()
      .select()
      .from(schema.mediaAsset)
      .where(scoped(schema.mediaAsset.organizationId, organizationId, inArray(schema.mediaAsset.id, ids)));
    for (const r of rows) medios.set(r.id, r);
  }

  const nuevos = new Set(inboundSinceLastReply(history));
  const pendientes = history
    .filter((m) => nuevos.has(m.id) && !m.transcript && m.mediaAssetId)
    .filter((m) => {
      const k = medios.get(m.mediaAssetId!)?.kind;
      return k === "audio" || k === "image";
    })
    .slice(-POR_TURNO);

  const oidos = new Map<string, string>();
  await Promise.all(
    pendientes.map(async (m) => {
      const texto = await oirOVer(organizationId, medios.get(m.mediaAssetId!)!, proveedores);
      if (!texto) return;
      const guardado = await guardarTranscripcion(organizationId, conversationId, m, texto);
      if (guardado) oidos.set(m.id, guardado);
    })
  );

  const lineas: LineaHistorial[] = [];
  for (const m of history) {
    const content = textoParaAgente(
      { ...m, transcript: oidos.get(m.id) ?? m.transcript },
      m.mediaAssetId ? medios.get(m.mediaAssetId) : null
    );
    if (content) lineas.push({ id: m.id, direction: m.direction, content });
  }
  return lineas;
}

/** Primera escritura gana (Nea puede haberla escrito a la vez). */
async function guardarTranscripcion(
  organizationId: string,
  conversationId: string,
  m: Mensaje,
  texto: string
): Promise<string | null> {
  try {
    const db = getDb();
    const updated = await db
      .update(schema.message)
      .set({ transcript: texto })
      .where(and(eq(schema.message.id, m.id), eq(schema.message.organizationId, organizationId), isNull(schema.message.transcript)))
      .returning({ transcript: schema.message.transcript });
    if (updated[0]?.transcript) {
      publish(organizationId, {
        type: "message.status",
        data: { conversationId, messageId: m.id, status: m.status, transcript: updated[0].transcript },
      });
      return updated[0].transcript;
    }
    const ganador = await db
      .select({ transcript: schema.message.transcript })
      .from(schema.message)
      .where(eq(schema.message.id, m.id))
      .limit(1);
    return ganador[0]?.transcript ?? texto;
  } catch (err) {
    console.warn(`[oir-y-ver] no se pudo guardar la transcripción de ${m.id}: ${err instanceof Error ? err.message : err}`);
    return texto;
  }
}

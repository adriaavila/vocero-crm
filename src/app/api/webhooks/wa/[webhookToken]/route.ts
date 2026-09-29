import { getEnv, isMockEnabled } from "@/lib/env";
import {
  isValidSignature,
  isValidWebhookToken,
  type WebhookPayload,
} from "@/server/inbox/webhook";
import { processEchoesValue, processMessagesValue } from "@/server/inbox/ingest";
import { processTemplateStatusValue } from "@/server/whatsapp/template-events";
// Fork — Embedded Signup en la app (server/agencia/whatsapp-signup): estos dos
// campos solo llegan tras pedir el sync de coexistencia y JAMÁS deben verse
// como un mensaje nuevo (sin publish, sin turno de agente).
import {
  processHistoryValue,
  processSmbAppStateSyncValue,
  type HistoryFieldValue,
  type SmbAppStateSyncValue,
} from "@/server/agencia/whatsapp-signup/history-sync";

/**
 * Webhook público de WhatsApp (contrato webhook.md).
 * Capa 1: el segmento [webhookToken] debe coincidir (si no → 404 sin efectos).
 * Capa 2: firma x-hub-signature-256 obligatoria, salvo mocks locales.
 * El POST confirma solo después de persistir; un 503 hace que Meta reintente.
 */
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ webhookToken: string }> };

export async function GET(req: Request, { params }: Params) {
  const { webhookToken } = await params;
  const env = getEnv();
  if (!isValidWebhookToken(webhookToken, env.META_WEBHOOK_VERIFY_TOKEN)) {
    return new Response(null, { status: 404 });
  }

  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === env.META_WEBHOOK_VERIFY_TOKEN) {
    return new Response(challenge ?? "", { status: 200 });
  }
  return new Response(null, { status: 403 });
}

export async function POST(req: Request, { params }: Params) {
  const { webhookToken } = await params;
  const env = getEnv();
  if (!isValidWebhookToken(webhookToken, env.META_WEBHOOK_VERIFY_TOKEN)) {
    return new Response(null, { status: 404 });
  }

  const rawBody = await req.text();
  const signature = req.headers.get("x-hub-signature-256");
  const validSignature =
    (isMockEnabled() && !env.META_APP_SECRET) ||
    isValidSignature(rawBody, signature, env.META_APP_SECRET);
  if (!validSignature) {
    return new Response(null, { status: 401 });
  }

  let payload: WebhookPayload;
  try {
    payload = JSON.parse(rawBody) as WebhookPayload;
  } catch {
    // body ilegible: 200 igualmente (Meta reintenta y termina desactivando)
    return Response.json({ received: true });
  }

  try {
    await processPayload(payload);
  } catch (err) {
    console.error("[webhook] error procesando payload:", err);
    return Response.json({ received: false }, { status: 503 });
  }

  return Response.json({ received: true });
}

async function processPayload(payload: WebhookPayload): Promise<void> {
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (!change.value) continue;
      if (change.field === "messages") {
        await processMessagesValue(change.value);
      } else if (change.field === "smb_message_echoes") {
        // 008: mensajes enviados a mano desde la app del teléfono (coexistence)
        await processEchoesValue(change.value);
      } else if (change.field === "message_template_status_update") {
        await processTemplateStatusValue(entry.id ?? null, change.value);
      } else if (change.field === "history") {
        // Best-effort a propósito: una forma de payload inesperada, o
        // cualquier otro error, jamás debe tumbar los `messages` del MISMO
        // payload que vengan después en este arreglo.
        try {
          await processHistoryValue(change.value as unknown as HistoryFieldValue);
        } catch (err) {
          console.error("[webhook] error procesando history:", err);
        }
      } else if (change.field === "smb_app_state_sync") {
        try {
          await processSmbAppStateSyncValue(change.value as unknown as SmbAppStateSyncValue);
        } catch (err) {
          console.error("[webhook] error procesando smb_app_state_sync:", err);
        }
      }
      // otros fields: ignorar sin error
    }
  }
}

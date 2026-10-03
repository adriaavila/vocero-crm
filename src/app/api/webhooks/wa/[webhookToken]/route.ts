import { getEnv, isMockEnabled } from "@/lib/env";
import { isValidSignature, isValidWebhookToken } from "@/server/inbox/webhook";
// Data spine (fork): guarda cada cambio crudo y lo procesa; ver
// server/agencia/raw-events.ts. Ahí vive el orden de los `field` y cada
// procesador (mensajes, echoes, plantillas, history, smb_app_state_sync).
import { receiveWhatsAppWebhook, safeErrorText } from "@/server/agencia/raw-events";

/**
 * Webhook público de WhatsApp (contrato webhook.md).
 * Capa 1: el segmento [webhookToken] debe coincidir (si no → 404 sin efectos).
 * Capa 2: firma x-hub-signature-256 obligatoria, salvo mocks locales.
 * El POST confirma solo después de persistir; un 503 hace que Meta reintente.
 * Cada cambio queda guardado en `raw_event` antes de procesarse (data spine).
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

  // Cada cambio se guarda crudo ANTES de procesarse; un cuerpo ilegible también
  // (200 igualmente: Meta reintenta y termina desactivando). Un procesador que
  // falla pide reintento con 503.
  try {
    const { retry } = await receiveWhatsAppWebhook(rawBody);
    if (retry) return Response.json({ received: false }, { status: 503 });
  } catch (err) {
    console.error(`[webhook] error procesando payload: ${safeErrorText(err)}`);
    return Response.json({ received: false }, { status: 503 });
  }

  return Response.json({ received: true });
}

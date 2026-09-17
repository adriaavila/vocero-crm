import { eq } from "drizzle-orm";
import { isAuthorized, resolveTargetOrg } from "@/server/provision/payload";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { getEnv } from "@/lib/env";
import { isAllokSaaSMode } from "@/lib/tenant-host";
import { resolveInstanceOrg } from "@/server/bot/auth";
import { normalizeRecipient } from "@/lib/meta/client";
import { callGraphSend } from "@/server/inbox/send";
import { getOrCreateContact, getOrCreateConversation } from "@/server/inbox/ingest";
import { getCredentialsByOrg } from "@/server/whatsapp/credentials";

export const dynamic = "force-dynamic";

/** Prueba de envío real invocada por Allok después de verificar el webhook. */
export async function POST(req: Request): Promise<Response> {
  if (!isAuthorized(req.headers.get("authorization"), process.env.PROVISION_API_KEY)) {
    return Response.json({ message: "No autorizado." }, { status: 401 });
  }

  const to = getEnv().WHATSAPP_SMOKE_TEST_TO;
  if (!to) return Response.json({ message: "WHATSAPP_SMOKE_TEST_TO no está configurado." }, { status: 503 });
  const normalizedTo = normalizeRecipient(to);
  if (!/^\+?[1-9]\d{6,14}$/.test(normalizedTo)) {
    return Response.json({ message: "WHATSAPP_SMOKE_TEST_TO no es un número válido." }, { status: 503 });
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const requestedOrg = typeof body?.organization_id === "string" && body.organization_id.trim()
    ? body.organization_id.trim()
    : null;
  const organizationId = await resolveOrganization(requestedOrg);
  if (!organizationId) return Response.json({ message: "La organización de la prueba no existe." }, { status: 409 });

  const credentials = await getCredentialsByOrg(organizationId);
  if (!credentials) return Response.json({ message: "No hay credenciales de WhatsApp provisionadas." }, { status: 409 });

  try {
    const { contact } = await getOrCreateContact(organizationId, normalizedTo, "Smoke test WhatsApp");
    const conversation = await getOrCreateConversation(organizationId, contact.id);
    const text = "Prueba automática de conexión de WhatsApp para Vocero.";
    const messageId = await callGraphSend(credentials, {
      messaging_product: "whatsapp",
      to: normalizedTo,
      type: "text",
      text: { body: text },
    });

    await getDb().insert(schema.message).values({
      id: newId("message"),
      organizationId,
      conversationId: conversation.id,
      waMessageId: messageId,
      direction: "out",
      type: "text",
      text,
      status: "pending",
      origin: "operator",
    });

    for (let attempt = 0; attempt < 8; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      const rows = await getDb()
        .select({ status: schema.message.status, error: schema.message.error })
        .from(schema.message)
        .where(eq(schema.message.waMessageId, messageId))
        .limit(1);
      const status = rows[0]?.status;
      if (status === "delivered" || status === "read") return Response.json({ ok: true });
      if (status === "failed") {
        return Response.json({ message: rows[0]?.error ?? "El webhook informó que Meta rechazó el mensaje." }, { status: 409 });
      }
    }
    return Response.json({ message: "Meta aceptó el mensaje, pero todavía no llegó su acuse por el webhook." }, { status: 504 });
  } catch (error) {
    return Response.json({
      message: error instanceof Error ? error.message : "Meta rechazó el smoke test.",
    }, { status: 502 });
  }
}

async function resolveOrganization(requested: string | null): Promise<string | null> {
  if (isAllokSaaSMode()) {
    if (!requested) return null;
    const rows = await getDb()
      .select({ id: schema.organization.id })
      .from(schema.organization)
      .where(eq(schema.organization.id, requested))
      .limit(1);
    return rows[0]?.id ?? null;
  }
  const target = resolveTargetOrg(requested, await resolveInstanceOrg());
  return target.ok ? target.organizationId : null;
}
